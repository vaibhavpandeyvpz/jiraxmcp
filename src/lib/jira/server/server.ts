import express, { type Express, type Request, type Response } from "express";
import type { JiraWebhookEvent } from "../types.js";
import { createDedupeMiddleware } from "./dedupe-middleware.js";
import { createSignatureVerificationMiddleware } from "./signature-verification-middleware.js";

export interface JiraWebhookApp {
  app: Express;
  stop(): void;
}

export function createJiraWebhookApp(
  onEvent: (event: JiraWebhookEvent) => Promise<void> | void,
  secret?: string,
): JiraWebhookApp {
  const app = express();
  const deduper = createDedupeMiddleware();

  app.get("/health", (_request: Request, response: Response): void => {
    response.status(200).json({ ok: true });
  });
  app.post(
    "/webhook",
    express.raw({
      type: "*/*",
      limit: "1mb",
    }),
    createSignatureVerificationMiddleware(secret),
    deduper.middleware,
    createWebhookHandler(onEvent),
  );

  return {
    app,
    stop() {
      deduper.stop();
    },
  };
}

function createWebhookHandler(
  onEvent: (event: JiraWebhookEvent) => Promise<void> | void,
): (request: Request, response: Response) => Promise<void> {
  return async (request, response) => {
    try {
      const raw = Buffer.isBuffer(request.body) ? request.body : undefined;
      if (!raw) {
        response.status(400).json({
          ok: false,
          error: "Webhook request body must be available as a raw Buffer.",
        });
        return;
      }

      const payload = toJsonObject(raw);
      const event = toWebhookEvent(payload);
      await onEvent(event);

      response.status(200).json({
        ok: true,
        event: event.event,
      });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toJsonObject(raw: Buffer): Record<string, unknown> {
  const str = raw.toString("utf8").trim();
  if (!str) {
    throw new Error("Webhook body is empty.");
  }

  const parsed = JSON.parse(str);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Webhook body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function toWebhookEvent(payload: Record<string, unknown>): JiraWebhookEvent {
  const issue = asRecord(payload.issue);
  const project =
    asRecord(asRecord(issue.fields).project) || asRecord(payload.project);
  const user =
    asRecord(payload.user) ||
    asRecord(payload.author) ||
    asRecord(asRecord(payload.comment).author);

  return {
    source: "jira",
    event: String(payload.webhookEvent ?? "jira:webhook"),
    timestamp: new Date().toISOString(),
    payload,
    issue: {
      key: issue.key ? String(issue.key) : undefined,
    },
    project: {
      key: project.key ? String(project.key) : undefined,
    },
    user: {
      id: user.accountId ? String(user.accountId) : undefined,
      name: user.displayName
        ? String(user.displayName)
        : user.name
          ? String(user.name)
          : undefined,
      email: user.emailAddress ? String(user.emailAddress) : undefined,
    },
  };
}
