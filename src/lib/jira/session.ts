import { writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { AgileClient, Version3Client } from "jira.js";
import type { CliIO } from "../cli-io.js";
import { ensureIssueAttachmentsRoot } from "../paths.js";
import type { JiraEnvironment, JiraWebhookEvent } from "./types.js";
import { JiraWebhookServer } from "./webhook-server.js";

const DEFAULT_WEBHOOK_PORT = 6543;
const INLINE_ATTACHMENT_LIMIT_BYTES = 50 * 1024 * 1024;

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
]);

type JsonObject = Record<string, unknown>;
type JiraIssueRecord = Record<string, any>;
type JiraAttachmentRecord = Record<string, any>;
type EnrichedJiraWebhookEvent = JiraWebhookEvent & {};

export class JiraSession extends EventEmitter {
  private readonly env: JiraEnvironment;
  private readonly version3: Version3Client;
  private readonly agile: AgileClient;

  private myself?: JsonObject;
  private webhooks?: JiraWebhookServer;

  constructor(
    private readonly io: CliIO,
    environment = resolveEnvironment(),
  ) {
    super();
    this.env = environment;

    const config =
      this.env.auth.kind === "basic"
        ? {
            host: this.env.host,
            authentication: {
              basic: {
                email: this.env.auth.email,
                apiToken: this.env.auth.apiToken,
              },
            },
          }
        : {
            host: this.env.host,
            authentication: {
              oauth2: {
                accessToken: this.env.auth.accessToken,
              },
            },
          };

    this.version3 = new Version3Client(config);
    this.agile = new AgileClient(config);
  }

  on(eventName: "webhook", listener: (event: JiraWebhookEvent) => void): this;
  on(eventName: string | symbol, listener: (...args: any[]) => void) {
    return super.on(eventName, listener);
  }

  async start(): Promise<void> {
    await this.getMe();
  }

  async startWebhookServer(): Promise<number> {
    if (this.webhooks) {
      return this.env.webhook.port;
    }

    this.webhooks = new JiraWebhookServer(
      this.env.webhook.host,
      this.env.webhook.port,
      async (event: JiraWebhookEvent) => {
        this.emit("webhook", await this.enrichWebhookEvent(event));
      },
      this.env.webhook.secret,
    );

    const port = await this.webhooks.start();
    this.io.line(
      `Listening for Jira webhooks on http://${this.env.webhook.host}:${port}/webhook`,
    );
    return port;
  }

  async destroy(): Promise<void> {
    if (!this.webhooks) {
      return;
    }

    await this.webhooks.stop();
    this.webhooks = undefined;
  }

  async getMe(): Promise<JsonObject> {
    if (!this.myself) {
      this.myself = toObject(
        await this.version3.myself.getCurrentUser({ expand: ["groups"] }),
      );
    }

    return this.myself;
  }

  private async enrichWebhookEvent(
    event: JiraWebhookEvent,
  ): Promise<EnrichedJiraWebhookEvent> {
    const user = event.user.id?.trim();
    if (!user) {
      return event;
    }

    if (event.user.name && event.user.email) {
      return event;
    }

    try {
      const matches = toArray(
        await this.version3.userSearch.findUsers({
          accountId: user,
          maxResults: 1,
        }),
      );
      const match = toObject(matches[0]);

      return {
        ...event,
        user: {
          id: user,
          name:
            event.user.name ??
            (match.displayName
              ? String(match.displayName)
              : match.name
                ? String(match.name)
                : undefined),
          email:
            event.user.email ??
            (match.emailAddress ? String(match.emailAddress) : undefined),
        },
      };
    } catch {
      return event;
    }
  }

  async getIssue(
    issueIdOrKey: string,
    fields?: string[],
    expand?: string,
    properties?: string[],
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issues.getIssue({
        issueIdOrKey,
        fields,
        expand,
        properties,
      }),
    );
  }

  async createIssue(
    fields: JsonObject,
    update?: JsonObject,
    transition?: { id?: string; name?: string },
    expand?: string,
  ): Promise<JsonObject> {
    const created = toObject(
      await this.version3.issues.createIssue({
        fields: normalizeIssueFields(fields),
        update,
        transition,
        updateHistory: true,
        returnIssue: true,
      } as any),
    );

    if (!created.key) {
      return {
        created,
      };
    }

    return {
      created,
      issue: await this.getIssue(String(created.key), undefined, expand),
    };
  }

  async updateIssue(
    issueIdOrKey: string,
    fields?: JsonObject,
    update?: JsonObject,
    transition?: { id?: string; name?: string },
    expand?: string,
  ): Promise<JsonObject> {
    await this.version3.issues.editIssue({
      issueIdOrKey,
      fields: fields ? normalizeIssueFields(fields) : undefined,
      update,
      transition,
      notifyUsers: true,
      returnIssue: false,
    } as any);

    return {
      success: true,
      issue: await this.getIssue(issueIdOrKey, undefined, expand),
    };
  }

  async deleteIssue(
    issueIdOrKey: string,
    deleteSubtasks?: boolean,
  ): Promise<JsonObject> {
    await this.version3.issues.deleteIssue({
      issueIdOrKey,
      deleteSubtasks,
    } as any);

    return {
      success: true,
      issueIdOrKey,
    };
  }

  async batchCreateIssues(
    issues: JsonObject[],
    dryRun?: boolean,
  ): Promise<JsonObject> {
    return toObject(
      await this.request("/rest/api/3/issue/bulk", {
        method: "POST",
        body: {
          issueUpdates: issues.map((issue) => ({
            fields: normalizeIssueFields(issue),
          })),
          validateOnly: dryRun,
        },
      }),
    );
  }

  async transitionIssue(
    issueIdOrKey: string,
    transitionId: string,
    fields?: JsonObject,
    update?: JsonObject,
    comment?: string,
  ): Promise<JsonObject> {
    const payload = toObject(update ?? {});
    if (comment?.trim()) {
      const updates = [
        {
          add: {
            body: toAdfDocument(comment),
          },
        },
      ];
      payload.comment = Array.isArray(payload.comment)
        ? [...(payload.comment as unknown[]), ...updates]
        : updates;
    }

    await this.request(
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/transitions`,
      {
        method: "POST",
        body: {
          transition: {
            id: transitionId,
          },
          fields: fields ? normalizeIssueFields(fields) : undefined,
          update: Object.keys(payload).length > 0 ? payload : undefined,
        },
      },
    );

    return {
      success: true,
      issueIdOrKey,
      transitionId,
    };
  }

  async getTransitions(
    issueIdOrKey: string,
    expand?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issues.getTransitions({
        issueIdOrKey,
        expand,
      }),
    );
  }

  async getAllProjects(
    query?: string,
    startAt?: number,
    maxResults?: number,
    orderBy?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.projects.searchProjects({
        query,
        startAt,
        maxResults,
        orderBy,
      } as any),
    );
  }

  async getProjectIssues(
    projectKeyOrId: string,
    jql?: string,
    fields?: string[],
    limit?: number,
    nextPageToken?: string,
    expand?: string,
  ): Promise<JsonObject> {
    const clause = `project = "${escapeJqlValue(projectKeyOrId)}"`;
    const normalizedJql = jql?.trim()
      ? `${clause} AND (${jql.trim()})`
      : clause;

    return this.searchIssues(
      normalizedJql,
      fields,
      limit,
      nextPageToken,
      expand,
    );
  }

  async searchIssues(
    jql: string,
    fields?: string[],
    limit?: number,
    nextPageToken?: string,
    expand?: string,
    properties?: string[],
    fieldsByKeys?: boolean,
    failFast?: boolean,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
        jql,
        fields,
        maxResults: limit,
        nextPageToken,
        expand,
        properties,
        fieldsByKeys,
        failFast,
      }),
    );
  }

  async searchFields(
    query?: string,
    ids?: string[],
    type?: "all" | "custom" | "system",
    startAt?: number,
    maxResults?: number,
  ): Promise<JsonObject> {
    const fields = toArray(await this.version3.issueFields.getFields());
    const normalizedQuery = query?.trim().toLowerCase();
    const idsSet = new Set(ids ?? []);

    const filtered = fields.filter((field) => {
      const fieldRecord = toObject(field);
      const fieldId = String(fieldRecord.id ?? "");
      const fieldName = String(fieldRecord.name ?? "").toLowerCase();
      const fieldDescription = String(
        fieldRecord.description ?? "",
      ).toLowerCase();
      const isCustom = Boolean(fieldRecord.custom);

      if (idsSet.size > 0 && !idsSet.has(fieldId)) {
        return false;
      }

      if (type === "custom" && !isCustom) {
        return false;
      }

      if (type === "system" && isCustom) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        fieldId.toLowerCase().includes(normalizedQuery) ||
        fieldName.includes(normalizedQuery) ||
        fieldDescription.includes(normalizedQuery)
      );
    });

    const normalizedStartAt = startAt ?? 0;
    const normalizedMaxResults = maxResults ?? filtered.length;

    return {
      startAt: normalizedStartAt,
      maxResults: normalizedMaxResults,
      total: filtered.length,
      values: filtered.slice(
        normalizedStartAt,
        normalizedStartAt + normalizedMaxResults,
      ),
    };
  }

  async getFieldOptions(
    fieldId: string,
    contextId?: number,
    startAt?: number,
    maxResults?: number,
  ): Promise<JsonObject> {
    let resolvedContextId = contextId;

    if (!resolvedContextId) {
      const contexts = toObject(
        await this.version3.issueCustomFieldContexts.getContextsForField({
          fieldId,
          startAt: 0,
          maxResults: 100,
        }),
      );

      const values = toArray(contexts.values);
      const globalContext = values.find(
        (value) => toObject(value).isGlobalContext === true,
      );
      const selected = globalContext ?? values[0];

      resolvedContextId = Number(toObject(selected).id);
      if (!resolvedContextId) {
        return {
          fieldId,
          values: [],
          message: "No field context found for the requested field.",
        };
      }
    }

    return toObject(
      await this.version3.issueCustomFieldOptions.getOptionsForContext({
        fieldId,
        contextId: resolvedContextId,
        startAt,
        maxResults,
      }),
    );
  }

  async getAgileBoards(
    name?: string,
    projectKeyOrId?: string,
    type?: string,
    startAt?: number,
    maxResults?: number,
    orderBy?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.board.getAllBoards({
        name,
        projectKeyOrId,
        type,
        startAt,
        maxResults,
        orderBy,
      }),
    );
  }

  async getBoardIssues(
    boardId: number,
    jql?: string,
    fields?: string[],
    startAt?: number,
    maxResults?: number,
    validateQuery?: boolean,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.board.getIssuesForBoard({
        boardId,
        jql,
        fields,
        startAt,
        maxResults,
        validateQuery,
      }),
    );
  }

  async getBoardSprints(
    boardId: number,
    state?: string,
    startAt?: number,
    maxResults?: number,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.board.getAllSprints({
        boardId,
        state,
        startAt,
        maxResults,
      }),
    );
  }

  async getSprintIssues(
    sprintId: number,
    jql?: string,
    fields?: string[],
    startAt?: number,
    maxResults?: number,
    validateQuery?: boolean,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.sprint.getIssuesForSprint({
        sprintId,
        jql,
        fields,
        startAt,
        maxResults,
        validateQuery,
      }),
    );
  }

  async createSprint(
    name: string,
    originBoardId: number,
    startDate?: string,
    endDate?: string,
    goal?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.sprint.createSprint({
        name,
        originBoardId,
        startDate,
        endDate,
        goal,
      }),
    );
  }

  async updateSprint(
    sprintId: number,
    name?: string,
    state?: string,
    startDate?: string,
    endDate?: string,
    goal?: string,
    originBoardId?: number,
  ): Promise<JsonObject> {
    return toObject(
      await this.agile.sprint.updateSprint({
        sprintId,
        name,
        state,
        startDate,
        endDate,
        goal,
        originBoardId,
      } as any),
    );
  }

  async addIssuesToSprint(
    sprintId: number,
    issues: string[],
    rankBeforeIssue?: string,
    rankAfterIssue?: string,
    rankCustomFieldId?: number,
  ): Promise<JsonObject> {
    await this.agile.sprint.moveIssuesToSprintAndRank({
      sprintId,
      issues,
      rankBeforeIssue,
      rankAfterIssue,
      rankCustomFieldId,
    });
    return {
      success: true,
      sprintId,
      issues,
    };
  }

  async addComment(
    issueIdOrKey: string,
    body: string,
    visibility?: JsonObject,
    parentId?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issueComments.addComment({
        issueIdOrKey,
        body: toAdfDocument(body),
        visibility: visibility as any,
        parentId,
      } as any),
    );
  }

  async editComment(
    issueIdOrKey: string,
    commentId: string,
    body: string,
    visibility?: JsonObject,
    notifyUsers?: boolean,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issueComments.updateComment({
        issueIdOrKey,
        id: commentId,
        body: toAdfDocument(body),
        visibility: visibility as any,
        notifyUsers,
      } as any),
    );
  }

  async batchGetChangelogs(
    issueIdsOrKeys: string[],
    fields?: string[],
    maxResults?: number,
    nextPageToken?: string,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issues.getBulkChangelogs({
        issueIdsOrKeys,
        fieldIds: fields,
        maxResults,
        nextPageToken,
      }),
    );
  }

  async getUserProfile(userId: string): Promise<JsonObject> {
    const identifier = userId.trim();
    if (!identifier || identifier === "me" || identifier === "currentUser()") {
      return {
        user: await this.getMe(),
      };
    }

    const exactByAccountId = toArray(
      await this.version3.userSearch.findUsers({
        accountId: identifier,
        maxResults: 1,
      }),
    );

    if (exactByAccountId.length > 0) {
      return {
        user: exactByAccountId[0],
      };
    }

    const matches = toArray(
      await this.version3.userSearch.findUsers({
        query: identifier,
        maxResults: 25,
      }),
    );

    const lower = identifier.toLowerCase();
    const exact =
      matches.find((candidate) => {
        const user = toObject(candidate);
        return (
          String(user.accountId ?? "").toLowerCase() === lower ||
          String(user.emailAddress ?? "").toLowerCase() === lower ||
          String(user.displayName ?? "").toLowerCase() === lower
        );
      }) ?? matches[0];

    return {
      user: exact ?? null,
      matches,
    };
  }

  async searchUsers(
    query?: string,
    accountId?: string,
    maxResults = 25,
  ): Promise<JsonObject> {
    const normalizedQuery = query?.trim();
    const normalizedAccountId = accountId?.trim();

    if (!normalizedQuery && !normalizedAccountId) {
      throw new Error("Provide query or accountId to search Jira users.");
    }

    const limit = Math.max(1, Math.min(maxResults, 100));
    const users: any[] = [];
    const seen = new Set<string>();

    if (normalizedAccountId) {
      const exactMatches = toArray(
        await this.version3.userSearch.findUsers({
          accountId: normalizedAccountId,
          maxResults: 1,
        }),
      );

      for (const candidate of exactMatches) {
        const user = toObject(candidate);
        const key =
          String(user.accountId ?? "").trim() ||
          String(user.emailAddress ?? "").trim() ||
          JSON.stringify(candidate);

        if (!seen.has(key)) {
          seen.add(key);
          users.push(candidate);
        }
      }
    }

    if (normalizedQuery) {
      const queryMatches = toArray(
        await this.version3.userSearch.findUsers({
          query: normalizedQuery,
          maxResults: limit,
        }),
      );

      for (const candidate of queryMatches) {
        const user = toObject(candidate);
        const key =
          String(user.accountId ?? "").trim() ||
          String(user.emailAddress ?? "").trim() ||
          JSON.stringify(candidate);

        if (!seen.has(key)) {
          seen.add(key);
          users.push(candidate);
        }

        if (users.length >= limit) {
          break;
        }
      }
    }

    return {
      query: normalizedQuery ?? null,
      accountId: normalizedAccountId ?? null,
      maxResults: limit,
      users,
    };
  }

  async getLinkTypes(): Promise<JsonObject> {
    return toObject(await this.version3.issueLinkTypes.getIssueLinkTypes());
  }

  async createIssueLink(
    typeName: string,
    inwardIssueKey: string,
    outwardIssueKey: string,
    comment?: string,
  ): Promise<JsonObject> {
    await this.version3.issueLinks.linkIssues({
      type: {
        name: typeName,
      } as any,
      inwardIssue: {
        key: inwardIssueKey,
      } as any,
      outwardIssue: {
        key: outwardIssueKey,
      } as any,
      comment: comment
        ? ({
            body: toAdfDocument(comment),
          } as any)
        : undefined,
    });

    return {
      success: true,
      typeName,
      inwardIssueKey,
      outwardIssueKey,
    };
  }

  async removeIssueLink(linkId: string): Promise<JsonObject> {
    await this.request(`/rest/api/3/issueLink/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
    });

    return {
      success: true,
      linkId,
    };
  }

  async linkToEpic(issueIdOrKey: string, epicKey: string): Promise<JsonObject> {
    try {
      await this.version3.issues.editIssue({
        issueIdOrKey: issueIdOrKey,
        fields: {
          parent: {
            key: epicKey,
          },
        },
      } as any);

      return {
        success: true,
        issueIdOrKey,
        epicKey,
        strategy: "parent",
      };
    } catch (error) {
      const fields = await this.searchFields("Epic Link", undefined, "custom");
      const epicLinkField = toArray(fields.values).find(
        (value) => String(toObject(value).name ?? "") === "Epic Link",
      );
      const epicLinkFieldId = String(toObject(epicLinkField).id ?? "");

      if (!epicLinkFieldId) {
        throw error;
      }

      await this.version3.issues.editIssue({
        issueIdOrKey,
        fields: {
          [epicLinkFieldId]: epicKey,
        },
      } as any);

      return {
        success: true,
        issueIdOrKey,
        epicKey,
        strategy: epicLinkFieldId,
      };
    }
  }

  async createRemoteIssueLink(
    issueIdOrKey: string,
    url: string,
    title: string,
    summary?: string,
    relationship?: string,
    globalId?: string,
    application?: JsonObject,
    icon?: JsonObject,
  ): Promise<JsonObject> {
    return toObject(
      await this.version3.issueRemoteLinks.createOrUpdateRemoteIssueLink({
        issueIdOrKey,
        relationship,
        globalId,
        application: application as any,
        object: {
          url,
          title,
          summary,
          icon,
        },
      } as any),
    );
  }

  async downloadAttachments(issueIdOrKey: string): Promise<JsonObject> {
    const attachments = await this.getAttachmentEntries(issueIdOrKey);
    const targetDir = await ensureIssueAttachmentsRoot(issueIdOrKey);

    const downloaded: JsonObject[] = [];
    const failed: JsonObject[] = [];
    const seenNames = new Set<string>();

    for (const attachment of attachments) {
      const attachmentId = String(attachment.id ?? "");
      const filename = uniqueFilename(
        sanitizeFilename(
          String((attachment.filename ?? attachmentId) || "attachment"),
        ),
        seenNames,
      );

      if (!attachmentId) {
        failed.push({
          filename,
          error: "Missing attachment id.",
        });
        continue;
      }

      if (Number(attachment.size ?? 0) > INLINE_ATTACHMENT_LIMIT_BYTES) {
        failed.push({
          id: attachmentId,
          filename,
          error: "Attachment exceeds the 50 MB download limit.",
        });
        continue;
      }

      try {
        const content =
          await this.version3.issueAttachments.getAttachmentContent({
            id: attachmentId,
            redirect: false,
          });
        const outputPath = resolve(targetDir, filename);
        await writeFile(outputPath, content);
        downloaded.push({
          id: attachmentId,
          filename,
          path: outputPath,
          size: Buffer.byteLength(content),
          mimeType: attachment.mimeType ?? attachment.content ?? null,
        });
      } catch (error) {
        failed.push({
          id: attachmentId,
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      success: true,
      issueIdOrKey,
      targetDir,
      downloaded,
      failed,
    };
  }

  async getIssueImages(issueIdOrKey: string): Promise<{
    summary: JsonObject;
    images: Array<{ mimeType: string; data: string }>;
  }> {
    const attachments = await this.getAttachmentEntries(issueIdOrKey);
    const images: Array<{ mimeType: string; data: string }> = [];
    const failed: JsonObject[] = [];
    let totalImages = 0;

    for (const attachment of attachments) {
      const mimeType = resolveImageMimeType(attachment);
      if (!mimeType) {
        continue;
      }

      totalImages += 1;

      const attachmentId = String(attachment.id ?? "");
      const filename = String((attachment.filename ?? attachmentId) || "image");
      const size = Number(attachment.size ?? 0);

      if (size > INLINE_ATTACHMENT_LIMIT_BYTES) {
        failed.push({
          filename,
          error: "Image exceeds the 50 MB inline limit.",
        });
        continue;
      }

      if (!attachmentId) {
        failed.push({
          filename,
          error: "Missing attachment id.",
        });
        continue;
      }

      try {
        const content =
          await this.version3.issueAttachments.getAttachmentContent({
            id: attachmentId,
            redirect: false,
          });

        if (Buffer.byteLength(content) > INLINE_ATTACHMENT_LIMIT_BYTES) {
          failed.push({
            filename,
            error: "Downloaded image exceeds the 50 MB inline limit.",
          });
          continue;
        }

        images.push({
          mimeType,
          data: Buffer.from(content).toString("base64"),
        });
      } catch (error) {
        failed.push({
          filename,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      summary: {
        success: true,
        issueIdOrKey,
        totalImages,
        downloaded: images.length,
        failed,
      },
      images,
    };
  }

  private async getAttachmentEntries(issueIdOrKey: string): Promise<
    Array<{
      id?: string;
      filename?: string;
      size?: number;
      mimeType?: string;
      content?: string;
    }>
  > {
    const issue = (await this.getIssue(issueIdOrKey, [
      "attachment",
    ])) as JiraIssueRecord;

    const attachmentRecords = toArray(
      (issue.fields as JiraIssueRecord | undefined)?.attachment,
    ) as JiraAttachmentRecord[];

    return attachmentRecords.map((attachment) => ({
      id: attachment.id ? String(attachment.id) : undefined,
      filename: attachment.filename ? String(attachment.filename) : undefined,
      size: attachment.size === undefined ? undefined : Number(attachment.size),
      mimeType:
        attachment.mimeType ?? attachment.mime_type ?? attachment.contentType,
      content: attachment.content,
    }));
  }

  private async request<T = unknown>(
    pathname: string,
    init: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const url = new URL(pathname, ensureTrailingSlash(this.env.host));
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");

    if (this.env.auth.kind === "basic") {
      headers.set(
        "authorization",
        `Basic ${Buffer.from(
          `${this.env.auth.email}:${this.env.auth.apiToken}`,
        ).toString("base64")}`,
      );
    } else {
      headers.set("authorization", `Bearer ${this.env.auth.accessToken}`);
    }

    const body =
      init.body === undefined
        ? undefined
        : typeof init.body === "string"
          ? init.body
          : JSON.stringify(init.body);

    if (body !== undefined) {
      headers.set("content-type", "application/json");
    }

    const response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        message || `Jira request failed with ${response.status}.`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}

function resolveEnvironment(): JiraEnvironment {
  const host = process.env.JIRA_HOST?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const accessToken = process.env.JIRA_ACCESS_TOKEN?.trim();
  const webhookHost = process.env.JIRA_WEBHOOK_HOST?.trim() || "127.0.0.1";
  const webhookSecret = process.env.JIRA_WEBHOOK_SECRET?.trim();
  const webhookPort = parsePort(process.env.JIRA_WEBHOOK_PORT);

  if (!host) {
    throw new Error("Set JIRA_HOST before starting jiraxmcp.");
  }

  if (accessToken) {
    return {
      host: stripTrailingSlash(host),
      auth: {
        kind: "oauth2",
        accessToken,
      },
      webhook: {
        host: webhookHost,
        port: webhookPort,
        secret: webhookSecret || undefined,
      },
    };
  }

  if (!email || !apiToken) {
    throw new Error(
      "Set JIRA_ACCESS_TOKEN or both JIRA_EMAIL and JIRA_API_TOKEN before starting jiraxmcp.",
    );
  }

  return {
    host: stripTrailingSlash(host),
    auth: {
      kind: "basic",
      email,
      apiToken,
    },
    webhook: {
      host: webhookHost,
      port: webhookPort,
      secret: webhookSecret || undefined,
    },
  };
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return DEFAULT_WEBHOOK_PORT;
  }

  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(
      `Invalid Jira webhook port "${value}". Set JIRA_WEBHOOK_PORT to a value between 1 and 65535.`,
    );
  }

  return port;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function toObject(value: unknown): JsonObject {
  return (value ?? {}) as JsonObject;
}

function toArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function normalizeIssueFields(fields: JsonObject): JsonObject {
  const normalized = { ...fields };

  if (typeof normalized.description === "string") {
    normalized.description = toAdfDocument(normalized.description);
  }

  if (typeof normalized.environment === "string") {
    normalized.environment = toAdfDocument(normalized.environment);
  }

  return normalized;
}

function toAdfDocument(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({
      type: "paragraph",
      content: block.split("\n").flatMap((line, index, lines) => {
        const parts: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: line,
          },
        ];

        if (index < lines.length - 1) {
          parts.push({ type: "hardBreak" });
        }

        return parts;
      }),
    }));

  return {
    version: 1,
    type: "doc",
    content:
      paragraphs.length > 0
        ? paragraphs
        : [
            {
              type: "paragraph",
              content: [],
            },
          ],
  };
}

function escapeJqlValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function sanitizeFilename(value: string): string {
  const name = basename(value).replace(/[^\w.-]+/g, "_");
  return name.length > 0 ? name : "attachment";
}

function uniqueFilename(filename: string, seenNames: Set<string>): string {
  if (!seenNames.has(filename)) {
    seenNames.add(filename);
    return filename;
  }

  const extension = extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let index = 1;
  let candidate = `${stem}_${index}${extension}`;

  while (seenNames.has(candidate)) {
    index += 1;
    candidate = `${stem}_${index}${extension}`;
  }

  seenNames.add(candidate);
  return candidate;
}

function resolveImageMimeType(attachment: {
  filename?: string;
  mimeType?: string;
}): string | undefined {
  const mimeType = String(attachment.mimeType ?? "");
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return mimeType;
  }

  const extension = extname(String(attachment.filename ?? "")).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) {
    return undefined;
  }

  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".bmp":
      return "image/bmp";
    default:
      return undefined;
  }
}
