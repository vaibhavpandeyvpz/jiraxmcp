import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_FOLDER = ".jiraxmcp";
const JIRAXMCP_HOME_ENV = "JIRAXMCP_HOME";

export function appRoot(): string {
  const override = process.env[JIRAXMCP_HOME_ENV]?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), APP_FOLDER);
}

export function attachmentsRoot(): string {
  return join(appRoot(), "attachments");
}

export function issueAttachmentsRoot(issueIdOrKey: string): string {
  return join(attachmentsRoot(), issueIdOrKey);
}

export async function ensureIssueAttachmentsRoot(
  issueIdOrKey: string,
): Promise<string> {
  const root = issueAttachmentsRoot(issueIdOrKey);
  await mkdir(root, { recursive: true });
  return root;
}
