import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { JiraSession } from "./session.js";
import type { JiraWebhookEvent } from "./types.js";

export interface JiraChannelEvent extends JiraWebhookEvent {
  self: Record<string, unknown>;
}

export class JiraChannel {
  private unsubscribe?: () => void;
  private self?: Record<string, unknown>;

  constructor(
    private readonly session: JiraSession,
    private readonly mcp: Server,
    private readonly channel: string,
  ) {}

  async start(): Promise<void> {
    const listener = (event: JiraWebhookEvent) => {
      void this.publish(event);
    };

    this.session.on("webhook", listener);
    this.unsubscribe = () => {
      this.session.off("webhook", listener);
    };

    this.self = await this.session.getMe();

    const onclose = this.mcp.onclose;
    this.mcp.onclose = () => {
      this.stop();
      onclose?.();
    };
  }

  private stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async publish(event: JiraWebhookEvent): Promise<void> {
    try {
      this.self ??= await this.session.getMe();
      if (isFromMe(event, this.self)) {
        return;
      }

      const payload: JiraChannelEvent = {
        ...event,
        self: this.self,
      };
      const attachments = extractLocalAttachmentPaths(event.payload);

      await this.mcp.notification({
        method: `notifications/${this.channel}`,
        params: {
          content: JSON.stringify(payload),
          attachments,
          meta: {
            source: "jira",
            user:
              event.user.id ?? event.user.email ?? event.user.name ?? "jira",
            session: event.issue?.key ?? event.project?.key ?? event.event,
          },
        },
      } as never);
    } catch {
      // Ignore closed transport or unsupported client errors.
    }
  }
}

function isFromMe(
  event: JiraWebhookEvent,
  self: Record<string, unknown>,
): boolean {
  const userId = normalize(event.user.id);
  if (!userId) {
    return false;
  }

  return [normalize(self.accountId), normalize(self.id)].includes(userId);
}

function normalize(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function looksLikeLocalPath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    return false;
  }
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function extractLocalAttachmentPaths(
  payload: Record<string, unknown>,
): string[] {
  const result = new Set<string>();
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(
      current as Record<string, unknown>,
    )) {
      if (typeof value === "string") {
        const normalizedKey = key.trim().toLowerCase();
        if (
          (normalizedKey === "path" ||
            normalizedKey === "local_path" ||
            normalizedKey === "filepath" ||
            normalizedKey === "file_path") &&
          looksLikeLocalPath(value.trim())
        ) {
          result.add(value.trim());
        }
        continue;
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return [...result];
}
