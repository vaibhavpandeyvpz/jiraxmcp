## Incoming Jira Webhooks

Incoming events from `jira` are one-way webhook notifications. Read them and act. Your final response will not be delivered back into Jira automatically.

Rule 1: Delivery

- If the user wants Jira to change state, add a comment, or update an issue, use Jira tools.
- Plain assistant output is only for the MCP host and does not mutate Jira.

Rule 2: Acting On Events

- Treat the webhook payload as fresh event context, not as confirmation that follow-up actions already happened.
- Do not claim an issue was updated, commented on, transitioned, or linked unless the corresponding Jira tool succeeds.

Rule 3: Identity And Session

- `meta.source` is always `jira`.
- `meta.user` is the best available Jira actor identifier from the webhook payload.
- `meta.session` is usually the issue key, otherwise the project key or webhook event name.

Notification Shape

- Incoming Jira webhooks are emitted as `notifications/<channel>`.
- The JSON-decoded notification content includes `source`, `self`, `event`, `timestamp`, `payload`, optional `issue.key` and `project.key`, and a `user` object with best-effort `id`, `name`, and `email`.

Examples

- If a webhook says an issue was assigned to you, inspect the issue first, then decide whether to acknowledge, summarize next steps, or transition it using Jira tools. Do not assume the assignment alone means work has started.
- If a comment asks a direct question or requests action, reply by adding a Jira comment only after you have enough information. If details are missing, add a clarifying comment with Jira tools rather than leaving the question only in assistant output.
- If a webhook reports a status change, treat that as fresh state. Verify current issue details before making follow-up transitions, comments, or field updates.

### Jira Workflow Examples

1. Newly assigned issue:
   - Read the webhook event and identify `issue.key`.
   - Fetch the issue if you need current status, assignee, summary, priority, or description before acting.
   - If the user asked for automatic triage, summarize the issue, identify blockers or missing fields, and use Jira tools to add a comment, update fields, or transition the issue.
   - If no explicit automation was requested, assistant output can summarize what happened for the MCP host, but it does not update Jira by itself.

2. Comment requires response:
   - Read the webhook event and identify the issue and comment context from the payload.
   - If the commenter asked a question, requested an update, or asked for action, gather any needed issue context first.
   - Add a Jira comment with the answer, a status update, or a clarification request using Jira tools.
   - Do not claim the issue was answered unless the Jira comment tool succeeds.

3. Transition or status workflow:
   - Read the webhook event and identify the current issue key and new status from the payload.
   - If the workflow should continue automatically, check the issue's current transitions before moving it again.
   - Use `jira_get_transitions` to discover valid next actions, then call `jira_transition_issue` with a valid transition id.
   - Prefer checking the live issue state before changing status again, especially after reopened, blocked, done, or moved-back events.

4. Triage after creation or update:
   - Read the webhook event for new or changed issues.
   - Fetch the issue when you need latest fields, labels, description, or custom field values.
   - If your workflow expects normalization, use Jira tools to set missing fields, add labels, link to an epic, or leave a triage comment.
   - When custom fields are involved, discover field ids first instead of guessing them.
