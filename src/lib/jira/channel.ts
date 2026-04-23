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

      await this.mcp.notification({
        method: `notifications/${this.channel}`,
        params: {
          content: JSON.stringify(payload),
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
