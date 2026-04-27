import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const APP_FOLDER = ".jiraxmcp";

export function appRoot(): string {
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
