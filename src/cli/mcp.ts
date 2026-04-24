import process from "node:process";
import type { Command as CommanderCommand } from "commander";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CliIO } from "../lib/cli-io.js";
import { JiraSession } from "../lib/jira/session.js";
import { JiraMcpServer } from "../lib/mcp/server.js";
import { register } from "../lib/signal-handler.js";
import type { CliCommand } from "../types.js";

export class McpCommand implements CliCommand {
  constructor(
    private readonly io = new CliIO(process.stderr, process.stderr),
  ) {}

  register(program: CommanderCommand): void {
    program
      .command("mcp")
      .description("Start the stdio MCP server for Jira Cloud")
      .option(
        "--channels",
        "Enable hooman/channel notifications for Jira webhooks",
      )
      .action(this.action.bind(this));
  }

  private async action(options: { channels?: boolean }): Promise<void> {
    let keep = false;
    const session = new JiraSession(this.io);

    const unregister = register(async () => {
      this.io.line("Shutting down Jira MCP server...");
      await session.destroy();
    });

    try {
      const server = JiraMcpServer.create(session, Boolean(options.channels));
      await server.start(new StdioServerTransport());
      this.io.line("Starting Jira MCP server...");
      await session.start();

      if (options.channels) {
        await session.startWebhookServer();
        await server.subscribe();
      }

      keep = true;
    } finally {
      unregister();
      if (!keep) {
        await session.destroy();
      }
    }
  }
}
