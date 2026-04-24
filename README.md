# jiraxmcp

[![npm version](https://img.shields.io/npm/v/jiraxmcp)](https://www.npmjs.com/package/jiraxmcp)
[![Publish to NPM](https://github.com/vaibhavpandeyvpz/jiraxmcp/actions/workflows/publish-npm.yml/badge.svg)](https://github.com/vaibhavpandeyvpz/jiraxmcp/actions/workflows/publish-npm.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

`jiraxmcp` is an open-source Jira stdio MCP server built on top of [`jira.js`](https://github.com/mrrefactoring/jira.js/), `commander`, and `@modelcontextprotocol/sdk`.

It lets MCP-compatible clients interact with Jira Cloud through issue, search, agile, comment, link, and attachment tools. It can also subscribe to inbound Jira webhook events through an MCP notification channel backed by a built-in HTTP server.

## Highlights

- Exposes Jira Cloud as an MCP server over stdio.
- Uses the official `jira.js` client for Jira REST and Agile API access.
- Supports either `JIRA_ACCESS_TOKEN` or `JIRA_EMAIL` plus `JIRA_API_TOKEN`.
- Provides issue CRUD, search, field lookup, agile board and sprint tools, comments, changelogs, links, and attachment helpers.
- Can emit incoming Jira webhook events over an optional MCP notification channel.
- Starts a built-in Express webhook listener on `/webhook` when channel mode is enabled.

## Requirements

- Node.js `24+`
- Jira Cloud base URL exported as `JIRA_HOST`
- Either:
  - `JIRA_EMAIL` and `JIRA_API_TOKEN`, or
  - `JIRA_ACCESS_TOKEN`

## Installation

Use it without installing globally:

```bash
npx jiraxmcp mcp
```

Or for local development:

```bash
npm install
npm run build
npm run dev -- mcp
```

## Quick Start

1. Export your Jira credentials:

```bash
export JIRA_HOST="https://your-domain.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-api-token"
```

Or with an access token:

```bash
export JIRA_HOST="https://your-domain.atlassian.net"
export JIRA_ACCESS_TOKEN="your-access-token"
```

2. Start the MCP server:

```bash
npx jiraxmcp mcp
```

3. If your MCP host supports notifications and you want inbound Jira webhook events, enable channels:

```bash
npx jiraxmcp mcp --channels
```

4. Configure Jira webhooks to point to your listener:

```text
http://your-host:6543/webhook
```

`JIRA_WEBHOOK_PORT` overrides the default listener port `6543`. `JIRA_WEBHOOK_HOST` controls the bind host and defaults to `127.0.0.1`.
If you configure a webhook secret in Jira admin webhooks, also set `JIRA_WEBHOOK_SECRET` so incoming `X-Hub-Signature` headers are verified before events are emitted.

The server uses stdio, so it is meant to be launched by an MCP client or wrapper rather than browsed directly in a terminal.

## CLI Usage

### MCP Server

```bash
npx jiraxmcp mcp
```

Starts the stdio MCP server for the configured Jira Cloud instance.

## MCP Tools

The server currently exposes these tools:

- `jira_get_issue`
- `jira_create_issue`
- `jira_update_issue`
- `jira_delete_issue`
- `jira_batch_create_issues`
- `jira_transition_issue`
- `jira_get_transitions`
- `jira_get_all_projects`
- `jira_get_project_issues`
- `jira_search_issues`
- `jira_search_fields`
- `jira_get_field_options`
- `jira_get_agile_boards`
- `jira_get_board_issues`
- `jira_get_sprints_from_board`
- `jira_get_sprint_issues`
- `jira_create_sprint`
- `jira_update_sprint`
- `jira_add_issues_to_sprint`
- `jira_add_comment`
- `jira_edit_comment`
- `jira_batch_get_changelogs`
- `jira_get_user_profile`
- `jira_search_users`
- `jira_get_link_types`
- `jira_create_issue_link`
- `jira_remove_issue_link`
- `jira_link_to_epic`
- `jira_create_remote_issue_link`
- `jira_download_attachments`
- `jira_get_issue_images`

## Push Channel

When started with `--channels`, the server:

- advertises the experimental MCP capability `hooman/channel`
- advertises `hooman/user` with path `meta.user`
- advertises `hooman/session` with path `meta.session`
- advertises `hooman/thread` with path `meta.thread`
- starts a built-in HTTP webhook listener on `/webhook`
- verifies `X-Hub-Signature` when `JIRA_WEBHOOK_SECRET` is set
- ignores duplicate webhook deliveries in memory using `X-Atlassian-Webhook-Identifier`
- emits `notifications/hooman/channel` for inbound Jira webhook events

Each notification includes:

- `content`: a JSON-encoded event payload
- `meta.source`: `jira`
- `meta.user`: the best available Jira actor identifier from the webhook payload
- `meta.session`: usually the issue key, otherwise the project key or webhook event name
- `meta.thread`: omitted for Jira webhook events

The JSON-decoded `content` payload includes:

- `source`
- `self`
- `event`
- `timestamp`
- `payload`
- `issue`: an object with optional `key`
- `project`: an object with optional `key`
- `user`: a best-effort object with `id`, `name`, and `email`

## Environment

`jiraxmcp` reads environment variables from the shell and from `.env` automatically.

Supported variables:

- `JIRA_HOST`
- `JIRA_EMAIL`
- `JIRA_API_TOKEN`
- `JIRA_ACCESS_TOKEN`
- `JIRA_WEBHOOK_PORT`
- `JIRA_WEBHOOK_HOST`
- `JIRA_WEBHOOK_SECRET`

If `JIRA_WEBHOOK_PORT` is not set, the webhook listener uses `6543`. `JIRA_WEBHOOK_HOST` defaults to `127.0.0.1`; set it to `0.0.0.0` if you need Jira to reach the listener from another machine. `JIRA_WEBHOOK_SECRET` is optional, but when set the webhook endpoint only accepts deliveries whose `X-Hub-Signature` matches the raw request body.

## Local Data

`jiraxmcp` stores local state under `./.jiraxmcp/` when that folder exists in the current working directory, otherwise `~/.jiraxmcp/`.

Downloaded issue attachments are saved under `attachments/` within that data directory.

## License

MIT. See [LICENSE](LICENSE).
