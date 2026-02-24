# Linear + GitHub + Codex Automation

This setup provides:

1. GitHub issue opened -> Linear issue created automatically.
2. Linear assignment event -> GitHub repository dispatch endpoint for Codex trigger handling.
3. Release tracking in Linear for `development -> master` PRs and `v*` tags.
4. Strict Linear branch/title enforcement for normal work PRs.
5. One AI reviewer source: Codex GitHub integration (OAuth).

## 0) Recommended Codex + Linear MCP configuration

Use the Linear MCP streamable HTTP endpoint with bearer token env var:

```bash
codex mcp remove linear
codex mcp add linear --url https://mcp.linear.app/mcp --bearer-token-env-var LINEAR_API_KEY
codex mcp list
codex mcp get linear
```

Expected:

- `url: https://mcp.linear.app/mcp`
- `bearer_token_env_var: LINEAR_API_KEY`
- `status: enabled`

Notes:

- Prefer this `/mcp` endpoint for Codex MCP connectivity.
- Keep the Linear API key in environment/secrets only; do not commit keys to repo files.

## 1) Configure repository secrets and variables

In GitHub repository settings, add:

- Secret: `LINEAR_API_KEY`
  - Linear API key (raw key format, not `Bearer`).
- Secret: `LINEAR_TEAM_ID`
  - Team ID for the target Linear team.
- Secret: `LINEAR_PROJECT_ID`
  - Project ID for the target Linear project.
- Variable: `STRICT_LINEAR_ENFORCEMENT`
  - Optional toggle for `.github/workflows/require-linked-issue.yml`.
  - Default/recommended: `true`.

Note:

- `OPENAI_API_KEY` is not required for this OAuth-first setup.

## 2) PR linking conventions (Linear-first)

Required for normal work PRs:

- Branch: `codex/CE-<number>-<slug>`
- Title: `[CE-<number>] <short title>`
- Branch ID and title ID must match.

Optional:

- Magic word in PR body/commit, for example: `Closes CE-123`
- If used, it must match the same `CE-<number>`.

Release exemption:

- `development -> master` release PRs are exempt from branch/title enforcement.

## 3) Existing Linear sync workflows

- `.github/workflows/sync-github-issue-to-linear.yml`
  - Trigger: `issues.opened`
  - Creates Linear issue and comments link back on GitHub issue.

- `.github/workflows/sync-release-pr-to-linear.yml`
  - Trigger: `pull_request` to `master` when `head == development`
  - Upserts/creates Linear release tracking ticket for the release PR.

- `.github/workflows/release-merge-create-tag.yml`
  - Trigger A: release PR `development -> master` when merged.
  - Trigger B: manual `workflow_dispatch` with `pr_number` for backfill.
  - Extracts `v*` version from PR title/body, creates tag on merge commit, upserts Linear tag ticket, and closes the release PR Linear ticket to `Done`.

- `.github/workflows/sync-release-tag-to-linear.yml`
  - Trigger: `push` tags matching `v*`
  - Creates Linear release tracking ticket for manual/published tag push events.

## 4) Codex review model (OAuth app-based)

Codex PR reviews are provided by the Codex GitHub integration (OAuth), not by a CI workflow.

Required repository-level policy:

- Follow `AGENTS.md` review output contract (structured headings and concise findings).

## 5) Disable duplicate AI reviewers (mandatory)

To keep a single AI reviewer source, disable:

1. CodeRabbit app on this repository.

Keep only:

- Codex GitHub integration review behavior for this repository.

## 6) External trigger example (Linear webhook bridge)

Use a service (n8n, Zapier, Cloudflare Worker, etc.) to forward Linear webhook events to GitHub:

```bash
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <GH_TOKEN_WITH_REPO_SCOPE>" \
  https://api.github.com/repos/<owner>/<repo>/dispatches \
  -d '{
    "event_type": "linear_issue_assigned_to_codex",
    "client_payload": {
      "linearIssueIdentifier": "<ISSUE_IDENTIFIER>",
      "linearIssueUrl": "https://linear.app/<workspace>/issue/<ISSUE_IDENTIFIER>/...",
      "githubIssueNumber": 6,
      "title": "Codex task trigger: <ISSUE_IDENTIFIER>"
    }
  }'
```
