import type { RequestHandler } from "express";

const DEDUPE_TTL_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

export interface JiraWebhookDeduper {
  middleware: RequestHandler;
  stop(): void;
}

export function createDedupeMiddleware(): JiraWebhookDeduper {
  const processed = new Map<string, number>();
  const timer = setInterval(() => {
    prune(processed);
  }, CLEANUP_INTERVAL_MS);

  timer.unref();

  return {
    middleware(request, response, next) {
      const identifier =
        request.header("X-Atlassian-Webhook-Identifier")?.trim() || undefined;

      if (!identifier) {
        next();
        return;
      }

      prune(processed);

      if (processed.has(identifier)) {
        response.status(200).json({
          ok: true,
          duplicate: true,
          event: tryGetEventType(request.body),
        });
        return;
      }

      response.once("finish", () => {
        if (response.statusCode < 400) {
          processed.set(identifier, Date.now() + DEDUPE_TTL_MS);
        }
      });

      next();
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function prune(processed: Map<string, number>): void {
  const now = Date.now();
  for (const [identifier, expiry] of processed) {
    if (expiry <= now) {
      processed.delete(identifier);
    }
  }
}

function tryGetEventType(body: unknown): string | undefined {
  if (!Buffer.isBuffer(body)) {
    return undefined;
  }

  try {
    const raw = body.toString("utf8").trim();
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as { webhookEvent?: unknown };
    return parsed.webhookEvent ? String(parsed.webhookEvent) : "jira:webhook";
  } catch {
    return undefined;
  }
}
