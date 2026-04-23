import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export function createSignatureVerificationMiddleware(
  secret?: string,
): RequestHandler {
  return (request, response, next) => {
    if (!secret) {
      next();
      return;
    }

    const raw = Buffer.isBuffer(request.body) ? request.body : undefined;
    if (!raw) {
      response.status(400).json({
        ok: false,
        error: "Webhook request body must be available as a raw Buffer.",
      });
      return;
    }

    const header = request.header("X-Hub-Signature");
    if (!header) {
      response.status(401).json({
        ok: false,
        error: "Missing X-Hub-Signature for signed Jira webhook.",
      });
      return;
    }

    const [algorithm, digest] = header.split("=", 2);
    if (!algorithm || !digest) {
      response.status(401).json({
        ok: false,
        error: "Invalid X-Hub-Signature format.",
      });
      return;
    }

    const calculated = `${algorithm}=${createHmac(algorithm, secret)
      .update(raw)
      .digest("hex")}`;

    if (!safeCompare(calculated, header)) {
      response.status(401).json({
        ok: false,
        error: "Jira webhook signature mismatch.",
      });
      return;
    }

    next();
  };
}

function safeCompare(left: string, right: string): boolean {
  const lb = Buffer.from(left);
  const rb = Buffer.from(right);

  if (lb.length !== rb.length) {
    return false;
  }

  return timingSafeEqual(lb, rb);
}
