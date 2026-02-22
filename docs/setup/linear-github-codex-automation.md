# Linear + GitHub + Codex Automation

This setup enables:

1. GitHub issue opened -> Linear issue created automatically.
2. Linear assignment event -> GitHub repository dispatch endpoint for Codex trigger handling.
3. Release events tracked in Linear automatically (`development -> master` PRs and `v*` tags).

## 1) Configure repository secrets and variables

In GitHub repository settings:

- Secret: `LINEAR_API_KEY`
  - Your Linear API key (header format is raw key, not `Bearer`).
- Variable: `LINEAR_TEAM_ID`
  - Example for this workspace: `a901c542-7bcb-4f89-9731-e753f16ee745` (`CE` team).
- Variable: `LINEAR_PROJECT_ID`
  - Project id for `WebRTC Audio Script (M-Game)`.

## 2) GitHub issue to Linear sync

Workflow: `.github/workflows/sync-github-issue-to-linear.yml`

Behavior:

- Trigger: `issues.opened`
- Creates Linear issue in configured team/project with title prefix:
  - `[GH#<issue-number>] <github-title>`
- Posts Linear link back to the GitHub issue as a comment.

## 3) Linear assignment to Codex trigger bridge

Workflow: `.github/workflows/codex-linear-assignment-dispatch.yml`

This workflow accepts:

- `repository_dispatch` event type: `linear_issue_assigned_to_codex`
- `workflow_dispatch` for manual testing

Expected `repository_dispatch` payload fields:

- `linearIssueIdentifier` (or `linear_issue_identifier`)
- `linearIssueUrl` (or `linear_issue_url`)
- optional `githubIssueNumber` (or `github_issue_number`)
- optional `title`

Behavior:

- If `githubIssueNumber` is provided:
  - posts a trigger comment on that GitHub issue.
- Otherwise:
  - creates a new GitHub issue with a trigger log.

## 4) External trigger example (for Linear webhook bridge)

Use a service (n8n, Zapier, Cloudflare Worker, etc.) that receives Linear webhook events and forwards to GitHub:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <GH_TOKEN_WITH_REPO_SCOPE>" \
  https://api.github.com/repos/<owner>/<repo>/dispatches \
  -d '{
    "event_type": "linear_issue_assigned_to_codex",
    "client_payload": {
      "linearIssueIdentifier": "CE-224",
      "linearIssueUrl": "https://linear.app/cris-emi/issue/CE-224/...",
      "githubIssueNumber": 6,
      "title": "Codex task trigger: CE-224"
    }
  }'
```

## 5) Release tracking to Linear

Workflow: `.github/workflows/sync-release-to-linear.yml`

Behavior:

- Trigger A: `pull_request` to `master` when `head == development`
  - Upserts (create/update) one Linear release ticket.
  - Keeps the mapping in a PR comment using hidden markers:
    - `linear-release-ticket-id`
    - `linear-release-ticket-identifier`
    - `linear-release-ticket-url`
  - On each PR sync/edit, updates the same Linear ticket instead of creating duplicates.

- Trigger B: `push` tag matching `v*`
  - Creates a Linear release tag ticket for the published version tag.

## 6) Notes

- This repository now supports agentic tracking and trigger logging.
- Actual autonomous code execution still depends on your Codex runner/orchestration layer.
- Keep issue-first policy: every run should trace to a GitHub issue and Linear issue.
