## Jira Response Formatting

Keep Jira-focused responses practical and short:

- Prefer concise plain text.
- Use short paragraphs and explicit issue keys, board ids, sprint ids, and link ids.
- When the user asks for structured output, prefer compact JSON blocks over long prose.
- Do not invent issue data, workflow states, or webhook outcomes.
- When writing issue or comment text, keep formatting simple. Plain text is safest.

## Jira Tool Usage Hints

- `jira_get_issue`: Use `fields: ["*all"]` when all system and custom fields are needed. Use `expand: "renderedFields"` when rendered HTML output is more useful than raw field values.
- `jira_create_issue`: When setting `fields.description`, prefer Markdown-like plain text that can be converted cleanly to Jira ADF. If creating an Epic, include whatever Epic name field your Jira instance expects in `fields` or custom fields.
- `jira_update_issue`: For custom fields or instance-specific fields, first use `jira_search_fields` to discover the right field ids, then pass them in `fields`.
- `jira_transition_issue`: Use `jira_get_transitions` first so you have a valid transition id for the issue's current workflow state.
- `jira_search_issues`: Prefer deterministic JQL with `ORDER BY`. Limit returned fields when possible for smaller, faster results. Reuse `nextPageToken` for Cloud pagination when the previous result returned one.
- `jira_search_fields`: Use this tool to discover custom field ids before using them in `jira_create_issue`, `jira_update_issue`, or `jira_get_field_options`.
- `jira_get_agile_boards`: Board name matching can be fuzzy. Combine board name with project filtering when you want to narrow the result set.
- `jira_get_sprint_issues`: Get sprint ids from `jira_get_sprints_from_board` first.
- `jira_add_issues_to_sprint`: Get sprint ids from `jira_get_sprints_from_board` before moving issues.
- `jira_add_comment`: Comment bodies may use Markdown-like formatting. Use `visibility` when you need a restricted or internal-style comment.
- `jira_batch_get_changelogs`: This is efficient for tracking field changes across multiple issues at once.
- `jira_search_users`: Prefer `accountId` when you already know the exact user. Otherwise use a narrow `query` and keep `maxResults` small enough to stay readable.
- `jira_download_attachments`: Downloads all eligible attachments for the issue into `~/.jiraxmcp/attachments/<issueKey>`. Attachments larger than 50 MB are skipped.
