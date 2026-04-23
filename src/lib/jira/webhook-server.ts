import type { Server } from "node:http";
import type { JiraWebhookEvent } from "./types.js";
import { createJiraWebhookApp, type JiraWebhookApp } from "./server/server.js";

export class JiraWebhookServer {
  private readonly app: JiraWebhookApp;
  private server?: Server;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly onEvent: (event: JiraWebhookEvent) => Promise<void> | void,
    private readonly secret?: string,
  ) {
    this.app = createJiraWebhookApp(this.onEvent, this.secret);
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.server = this.app.app.listen(this.port, this.host, () => {
        resolve();
      });
      this.server.once("error", reject);
    });

    return this.port;
  }

  async stop(): Promise<void> {
    this.app.stop();

    if (!this.server?.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}
