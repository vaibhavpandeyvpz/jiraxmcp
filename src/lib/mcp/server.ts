import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  ImageContent,
  TextContent,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { JiraChannel } from "../jira/channel.js";
import type { JiraSession } from "../jira/session.js";
import { packageMetadata } from "../package-metadata.js";
import { createJsonResult } from "./helpers.js";

const looseObjectSchema = z.record(z.string(), z.any());
const HOOMAN_CHANNEL = "hooman/channel";

function instructions(channel = false): string {
  const files = ["formatting.md", channel ? "channel.md" : null].filter(
    Boolean,
  );
  const root = dirname(fileURLToPath(import.meta.url));
  const sections = files.map((file) =>
    readFileSync(resolve(root, `../../prompts/${file}`), "utf8").trim(),
  );
  return `${sections.join("\n\n").trim()}\n`;
}

export class JiraMcpServer {
  readonly mcp: McpServer;

  private constructor(
    private readonly session: JiraSession,
    private readonly channels: boolean,
  ) {
    this.mcp = new McpServer(
      {
        name: packageMetadata.name,
        version: packageMetadata.version,
      },
      {
        capabilities: {
          experimental: channels
            ? {
                "hooman/user": { path: "meta.user" },
                "hooman/session": { path: "meta.session" },
                "hooman/thread": { path: "meta.thread" },
                [HOOMAN_CHANNEL]: {},
              }
            : undefined,
        },
        instructions: instructions(channels),
      },
    );
  }

  static create(session: JiraSession, channels: boolean): JiraMcpServer {
    const server = new JiraMcpServer(session, channels);
    server.registerTools();
    return server;
  }

  async start(transport: Transport): Promise<void> {
    await this.mcp.connect(transport);
  }

  async subscribe(): Promise<void> {
    if (!this.channels) {
      throw new Error("Channels are not enabled");
    }

    const channel = new JiraChannel(
      this.session,
      this.mcp.server,
      HOOMAN_CHANNEL,
    );
    await channel.start();
  }

  private registerTools(): void {
    this.mcp.registerTool(
      "jira_get_issue",
      {
        title: "Get Issue",
        description: "Get details for a Jira issue by key.",
        inputSchema: z.object({
          issueKey: z
            .string()
            .describe("Target Jira issue key, for example PROJ-123."),
          fields: z.array(z.string()).optional(),
          expand: z.string().optional(),
          properties: z.array(z.string()).optional(),
        }),
      },
      async ({ issueKey, fields, expand, properties }) =>
        createJsonResult(
          await this.session.getIssue(issueKey, fields, expand, properties),
        ),
    );

    this.mcp.registerTool(
      "jira_create_issue",
      {
        title: "Create Issue",
        description: "Create a Jira issue with arbitrary fields.",
        inputSchema: z.object({
          fields: looseObjectSchema.describe("Jira issue fields payload."),
          update: looseObjectSchema.optional(),
          transition: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
            })
            .optional(),
          expand: z.string().optional(),
        }),
      },
      async ({ fields, update, transition, expand }) =>
        createJsonResult(
          await this.session.createIssue(fields, update, transition, expand),
        ),
    );

    this.mcp.registerTool(
      "jira_update_issue",
      {
        title: "Update Issue",
        description: "Update a Jira issue by key.",
        inputSchema: z.object({
          issueKey: z.string().describe("Target Jira issue key."),
          fields: looseObjectSchema.optional(),
          update: looseObjectSchema.optional(),
          transition: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
            })
            .optional(),
          expand: z.string().optional(),
        }),
      },
      async ({ issueKey, fields, update, transition, expand }) =>
        createJsonResult(
          await this.session.updateIssue(
            issueKey,
            fields,
            update,
            transition,
            expand,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_delete_issue",
      {
        title: "Delete Issue",
        description: "Delete a Jira issue by key.",
        inputSchema: z.object({
          issueKey: z.string().describe("Target Jira issue key."),
          deleteSubtasks: z.boolean().optional(),
        }),
      },
      async ({ issueKey, deleteSubtasks }) =>
        createJsonResult(
          await this.session.deleteIssue(issueKey, deleteSubtasks),
        ),
    );

    this.mcp.registerTool(
      "jira_batch_create_issues",
      {
        title: "Batch Create Issues",
        description: "Create multiple Jira issues in one request.",
        inputSchema: z.object({
          issues: z
            .array(looseObjectSchema)
            .min(1)
            .max(50)
            .describe("Array of Jira issue fields payloads."),
          validateOnly: z.boolean().optional(),
        }),
      },
      async ({ issues, validateOnly }) =>
        createJsonResult(
          await this.session.batchCreateIssues(issues, validateOnly),
        ),
    );

    this.mcp.registerTool(
      "jira_transition_issue",
      {
        title: "Transition Issue",
        description: "Move a Jira issue through a workflow transition.",
        inputSchema: z.object({
          issueKey: z.string().describe("Target Jira issue key."),
          transitionId: z.string().describe("Workflow transition id."),
          fields: looseObjectSchema.optional(),
          update: looseObjectSchema.optional(),
          comment: z.string().optional(),
        }),
      },
      async ({ issueKey, transitionId, fields, update, comment }) =>
        createJsonResult(
          await this.session.transitionIssue(
            issueKey,
            transitionId,
            fields,
            update,
            comment,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_transitions",
      {
        title: "Get Transitions",
        description: "List available workflow transitions for an issue.",
        inputSchema: z.object({
          issueKey: z.string().describe("Target Jira issue key."),
          expand: z.string().optional(),
        }),
      },
      async ({ issueKey, expand }) =>
        createJsonResult(await this.session.getTransitions(issueKey, expand)),
    );

    this.mcp.registerTool(
      "jira_get_all_projects",
      {
        title: "Get All Projects",
        description: "List visible Jira projects with optional filtering.",
        inputSchema: z.object({
          query: z.string().optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).max(100).optional(),
          orderBy: z.string().optional(),
        }),
      },
      async ({ query, startAt, maxResults, orderBy }) =>
        createJsonResult(
          await this.session.getAllProjects(
            query,
            startAt,
            maxResults,
            orderBy,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_project_issues",
      {
        title: "Get Project Issues",
        description: "Search issues that belong to a Jira project.",
        inputSchema: z.object({
          projectKey: z.string().describe("Target Jira project key."),
          jql: z.string().optional(),
          fields: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          nextPageToken: z.string().optional(),
          expand: z.string().optional(),
        }),
      },
      async ({ projectKey, jql, fields, limit, nextPageToken, expand }) =>
        createJsonResult(
          await this.session.getProjectIssues(
            projectKey,
            jql,
            fields,
            limit,
            nextPageToken,
            expand,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_search_issues",
      {
        title: "Search Issues",
        description: "Search Jira issues using JQL.",
        inputSchema: z.object({
          jql: z.string().describe("Bounded JQL query."),
          fields: z.array(z.string()).optional(),
          limit: z.number().int().min(1).max(5000).optional(),
          nextPageToken: z.string().optional(),
          expand: z.string().optional(),
          properties: z.array(z.string()).optional(),
          fieldsByKeys: z.boolean().optional(),
          failFast: z.boolean().optional(),
        }),
      },
      async ({
        jql,
        fields,
        limit,
        nextPageToken,
        expand,
        properties,
        fieldsByKeys,
        failFast,
      }) =>
        createJsonResult(
          await this.session.searchIssues(
            jql,
            fields,
            limit,
            nextPageToken,
            expand,
            properties,
            fieldsByKeys,
            failFast,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_search_fields",
      {
        title: "Search Fields",
        description: "Search Jira fields by name, description, or id.",
        inputSchema: z.object({
          query: z.string().optional(),
          ids: z.array(z.string()).optional(),
          type: z.enum(["all", "custom", "system"]).optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
        }),
      },
      async ({ query, ids, type, startAt, maxResults }) =>
        createJsonResult(
          await this.session.searchFields(
            query,
            ids,
            type,
            startAt,
            maxResults,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_field_options",
      {
        title: "Get Field Options",
        description: "Get allowed options for a Jira custom field context.",
        inputSchema: z.object({
          fieldId: z
            .string()
            .describe("Custom field id, for example customfield_10010."),
          contextId: z.number().int().positive().optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
        }),
      },
      async ({ fieldId, contextId, startAt, maxResults }) =>
        createJsonResult(
          await this.session.getFieldOptions(
            fieldId,
            contextId,
            startAt,
            maxResults,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_agile_boards",
      {
        title: "Get Agile Boards",
        description: "List Jira Software boards.",
        inputSchema: z.object({
          name: z.string().optional(),
          projectKeyOrId: z.string().optional(),
          type: z.string().optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
          orderBy: z.string().optional(),
        }),
      },
      async ({ name, projectKeyOrId, type, startAt, maxResults, orderBy }) =>
        createJsonResult(
          await this.session.getAgileBoards(
            name,
            projectKeyOrId,
            type,
            startAt,
            maxResults,
            orderBy,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_board_issues",
      {
        title: "Get Board Issues",
        description: "List issues visible on a Jira board.",
        inputSchema: z.object({
          boardId: z.number().int().positive(),
          jql: z.string().optional(),
          fields: z.array(z.string()).optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
          validateQuery: z.boolean().optional(),
        }),
      },
      async ({ boardId, jql, fields, startAt, maxResults, validateQuery }) =>
        createJsonResult(
          await this.session.getBoardIssues(
            boardId,
            jql,
            fields,
            startAt,
            maxResults,
            validateQuery,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_sprints_from_board",
      {
        title: "Get Sprints from Board",
        description: "List sprints for a Jira board.",
        inputSchema: z.object({
          boardId: z.number().int().positive(),
          state: z.string().optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
        }),
      },
      async ({ boardId, state, startAt, maxResults }) =>
        createJsonResult(
          await this.session.getBoardSprints(
            boardId,
            state,
            startAt,
            maxResults,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_sprint_issues",
      {
        title: "Get Sprint Issues",
        description: "List issues assigned to a sprint.",
        inputSchema: z.object({
          sprintId: z.number().int().positive(),
          jql: z.string().optional(),
          fields: z.array(z.string()).optional(),
          startAt: z.number().int().min(0).optional(),
          maxResults: z.number().int().min(1).optional(),
          validateQuery: z.boolean().optional(),
        }),
      },
      async ({ sprintId, jql, fields, startAt, maxResults, validateQuery }) =>
        createJsonResult(
          await this.session.getSprintIssues(
            sprintId,
            jql,
            fields,
            startAt,
            maxResults,
            validateQuery,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_create_sprint",
      {
        title: "Create Sprint",
        description: "Create a future sprint on a board.",
        inputSchema: z.object({
          name: z.string(),
          originBoardId: z.number().int().positive(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          goal: z.string().optional(),
        }),
      },
      async ({ name, originBoardId, startDate, endDate, goal }) =>
        createJsonResult(
          await this.session.createSprint(
            name,
            originBoardId,
            startDate,
            endDate,
            goal,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_update_sprint",
      {
        title: "Update Sprint",
        description: "Update an existing sprint.",
        inputSchema: z.object({
          sprintId: z.number().int().positive(),
          name: z.string().optional(),
          state: z.string().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          goal: z.string().optional(),
          originBoardId: z.number().int().positive().optional(),
        }),
      },
      async ({
        sprintId,
        name,
        state,
        startDate,
        endDate,
        goal,
        originBoardId,
      }) =>
        createJsonResult(
          await this.session.updateSprint(
            sprintId,
            name,
            state,
            startDate,
            endDate,
            goal,
            originBoardId,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_add_issues_to_sprint",
      {
        title: "Add Issues to Sprint",
        description: "Move issues into an open or active sprint.",
        inputSchema: z.object({
          sprintId: z.number().int().positive(),
          issues: z.array(z.string()).min(1).max(50),
          rankBeforeIssue: z.string().optional(),
          rankAfterIssue: z.string().optional(),
          rankCustomFieldId: z.number().int().positive().optional(),
        }),
      },
      async ({
        sprintId,
        issues,
        rankBeforeIssue,
        rankAfterIssue,
        rankCustomFieldId,
      }) =>
        createJsonResult(
          await this.session.addIssuesToSprint(
            sprintId,
            issues,
            rankBeforeIssue,
            rankAfterIssue,
            rankCustomFieldId,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_add_comment",
      {
        title: "Add Comment",
        description: "Add a comment to a Jira issue.",
        inputSchema: z.object({
          issueKey: z.string(),
          body: z.string().describe("Comment body text."),
          visibility: looseObjectSchema.optional(),
          parentId: z.string().optional(),
        }),
      },
      async ({ issueKey, body, visibility, parentId }) =>
        createJsonResult(
          await this.session.addComment(issueKey, body, visibility, parentId),
        ),
    );

    this.mcp.registerTool(
      "jira_edit_comment",
      {
        title: "Edit Comment",
        description: "Edit a Jira issue comment.",
        inputSchema: z.object({
          issueKey: z.string(),
          commentId: z.string(),
          body: z.string(),
          visibility: looseObjectSchema.optional(),
          notifyUsers: z.boolean().optional(),
        }),
      },
      async ({ issueKey, commentId, body, visibility, notifyUsers }) =>
        createJsonResult(
          await this.session.editComment(
            issueKey,
            commentId,
            body,
            visibility,
            notifyUsers,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_batch_get_changelogs",
      {
        title: "Batch Get Changelogs",
        description: "Fetch changelogs for multiple Jira issues.",
        inputSchema: z.object({
          issueIdsOrKeys: z.array(z.string()).min(1).max(1000),
          fields: z.array(z.string()).optional(),
          maxResults: z.number().int().min(1).optional(),
          nextPageToken: z.string().optional(),
        }),
      },
      async ({ issueIdsOrKeys, fields, maxResults, nextPageToken }) =>
        createJsonResult(
          await this.session.batchGetChangelogs(
            issueIdsOrKeys,
            fields,
            maxResults,
            nextPageToken,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_get_user_profile",
      {
        title: "Get User Profile",
        description: "Look up a Jira user profile.",
        inputSchema: z.object({
          userIdentifier: z
            .string()
            .describe("Account id, email, display name, or me."),
        }),
      },
      async ({ userIdentifier }) =>
        createJsonResult(await this.session.getUserProfile(userIdentifier)),
    );

    this.mcp.registerTool(
      "jira_search_users",
      {
        title: "Search Users",
        description: "Search Jira users by query or account id.",
        inputSchema: z
          .object({
            query: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe("Free-text query like name or email."),
            accountId: z
              .string()
              .trim()
              .min(1)
              .optional()
              .describe("Exact Jira account id."),
            maxResults: z
              .number()
              .int()
              .min(1)
              .max(100)
              .optional()
              .describe("Maximum number of users to return. Defaults to 25."),
          })
          .refine((value) => value.query || value.accountId, {
            message: "Provide query or accountId.",
          }),
      },
      async ({ query, accountId, maxResults }) =>
        createJsonResult(
          await this.session.searchUsers(query, accountId, maxResults),
        ),
    );

    this.mcp.registerTool(
      "jira_get_link_types",
      {
        title: "Get Link Types",
        description: "List available Jira issue link types.",
      },
      async () => createJsonResult(await this.session.getLinkTypes()),
    );

    this.mcp.registerTool(
      "jira_create_issue_link",
      {
        title: "Create Issue Link",
        description: "Create a link between two Jira issues.",
        inputSchema: z.object({
          typeName: z.string().describe("Issue link type name."),
          inwardIssueKey: z.string(),
          outwardIssueKey: z.string(),
          comment: z.string().optional(),
        }),
      },
      async ({ typeName, inwardIssueKey, outwardIssueKey, comment }) =>
        createJsonResult(
          await this.session.createIssueLink(
            typeName,
            inwardIssueKey,
            outwardIssueKey,
            comment,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_remove_issue_link",
      {
        title: "Remove Issue Link",
        description: "Delete an issue link by id.",
        inputSchema: z.object({
          linkId: z.string(),
        }),
      },
      async ({ linkId }) =>
        createJsonResult(await this.session.removeIssueLink(linkId)),
    );

    this.mcp.registerTool(
      "jira_link_to_epic",
      {
        title: "Link to Epic",
        description: "Link an issue to a Jira epic.",
        inputSchema: z.object({
          issueKey: z.string(),
          epicKey: z.string(),
        }),
      },
      async ({ issueKey, epicKey }) =>
        createJsonResult(await this.session.linkToEpic(issueKey, epicKey)),
    );

    this.mcp.registerTool(
      "jira_create_remote_issue_link",
      {
        title: "Create Remote Issue Link",
        description: "Attach a remote URL to a Jira issue.",
        inputSchema: z.object({
          issueKey: z.string(),
          url: z.string().url(),
          title: z.string(),
          summary: z.string().optional(),
          relationship: z.string().optional(),
          globalId: z.string().optional(),
          application: looseObjectSchema.optional(),
          icon: looseObjectSchema.optional(),
        }),
      },
      async ({
        issueKey,
        url,
        title,
        summary,
        relationship,
        globalId,
        application,
        icon,
      }) =>
        createJsonResult(
          await this.session.createRemoteIssueLink(
            issueKey,
            url,
            title,
            summary,
            relationship,
            globalId,
            application,
            icon,
          ),
        ),
    );

    this.mcp.registerTool(
      "jira_download_attachments",
      {
        title: "Download Attachments",
        description:
          "Download all attachments for a Jira issue into ~/.jiraxmcp/attachments/<issueKey>.",
        inputSchema: z.object({
          issueKey: z.string(),
        }),
      },
      async ({ issueKey }) =>
        createJsonResult(await this.session.downloadAttachments(issueKey)),
    );

    this.mcp.registerTool(
      "jira_get_issue_images",
      {
        title: "Get Issue Images",
        description:
          "Return image attachments for a Jira issue as inline image content.",
        inputSchema: z.object({
          issueKey: z.string(),
        }),
      },
      async ({ issueKey }) => {
        const result = await this.session.getIssueImages(issueKey);
        const content: Array<TextContent | ImageContent> = [
          {
            type: "text",
            text: JSON.stringify(result.summary, null, 2),
          },
          ...result.images.map(
            (image): ImageContent => ({
              type: "image",
              data: image.data,
              mimeType: image.mimeType,
            }),
          ),
        ];

        return {
          content,
          structuredContent: result.summary,
        };
      },
    );
  }
}
