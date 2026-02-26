# Linear + GitHub + Codex Automation

This setup provides:

1. GitHub issue opened -> Linear issue created automatically.
2. Linear assignment event -> Codex dispatch workflow and automatic Linear transition to `In Progress`.
3. Codex work PR lifecycle automation:
   - auto-create PR from `codex/CE-*` branches
   - move Linear issue to `In Review` when PR opens or becomes ready
4. Release tracking in Linear for `development -> master` PRs and `v*` tags.
5. Strict Linear branch/title enforcement for normal work PRs.
6. One AI reviewer source: Codex GitHub integration (OAuth).

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

## 1) Configure repository secrets

In GitHub repository settings, add:

- Secret: `LINEAR_API_KEY`
  - Linear API key (raw key format, not `Bearer`).
- Secret: `LINEAR_TEAM_ID`
  - Team ID for the target Linear team (kept private).
- Secret: `LINEAR_PROJECT_ID`
  - Project ID for this repository (kept private).
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

Compatibility bridge:

- If Linear/Codex starts work from `ce-<number>-<slug>` or `feature/ce-<number>-<slug>`, automation normalizes it to `codex/CE-<number>-<slug>` and creates/updates the PR from the canonical branch.

Optional:

- Magic word in PR body/commit, for example: `Closes CE-123`
- If used, it must match the same `CE-<number>`.

Release exemption:

- `development -> master` release PRs are exempt from branch/title enforcement.

## 3) Existing Linear sync workflows

- `.github/workflows/sync-github-issue-to-linear.yml`
  - Trigger: `issues.opened`
  - Creates Linear issue and comments link back on GitHub issue.

- `.github/workflows/codex-linear-assignment-dispatch.yml`
  - Trigger: `repository_dispatch` (`linear_issue_assigned_to_codex`) and manual dispatch.
  - Records Codex trigger behavior and moves matching Linear issue to `In Progress`.

- `.github/workflows/sync-pr-state-to-linear.yml`
  - Trigger: PR `opened`, `reopened`, and `ready_for_review` into `development`.
  - Moves matching Linear issue (`CE-*`) to `In Review` for active review state tracking.

- `.github/workflows/auto-create-pr-from-codex-branch.yml`
  - Trigger: `push` to `codex/**`, `ce-*`, and `feature/ce-*` branches.
  - Canonicalizes compatible legacy branch names (`ce-*`, `feature/ce-*`) to `codex/CE-*` and keeps canonical branch refs updated to latest SHA.
  - Auto-creates a PR to `development` from canonical `codex/CE-*` branch if one does not already exist.

- `.github/workflows/sync-release-pr-to-linear.yml`
  - Trigger: `pull_request` to `master` when `head == development`.
  - Upserts/creates Linear release tracking ticket for the release PR.

- `.github/workflows/release-merge-create-tag.yml`
  - Trigger A: release PR `development -> master` when merged.
  - Trigger B: manual `workflow_dispatch` with `pr_number` for backfill.
  - Extracts `v*` version from PR title/body, creates tag on merge commit, upserts Linear tag ticket, and closes the release PR Linear ticket to `Done`.

- `.github/workflows/sync-ce-pr-merge-to-linear-done.yml`
  - Trigger A: `pull_request.closed` for merged PRs into `development` when `head` starts with `codex/CE-`.
  - Trigger B: manual `workflow_dispatch` for backfill.
  - Extracts CE identifiers from PR title/body/head branch, normalizes and deduplicates all matches, then marks each matching Linear issue as `Done` (idempotent per issue).
  - `workflow_dispatch` supports one or more identifiers via `ce_identifiers` (space/comma/newline separated), optionally combined with `pr_number`.

- `.github/workflows/sync-release-tag-to-linear.yml`
  - Trigger: `push` tags matching `v*`.
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
      "linearIssueUrl": "<LINEAR_ISSUE_URL>",
      "githubIssueNumber": 6,
      "title": "Codex task trigger: <ISSUE_IDENTIFIER>"
    }
  }'
```


## 7) Runbook and observability

- Runbook: [`docs/setup/linear-sync-runbook.md`](./linear-sync-runbook.md)
- Each Linear sync workflow emits structured status lines in this format:
  - `linear_sync ce_id=<identifier> status=<updated|already_done|not_found|failed> reason=<optional>`
- Use this output for audit, alerting, and manual replay triage.

## 8) Workflow reliability controls

- `validate.yml` enforces workflow quality checks via:
  - `actionlint` (YAML + workflow linting)
  - shell strict mode checks for helper scripts
  - PR payload smoke tests for branch/title + CE linkage cases
- Linear API error handling should classify failures into:
  - `infra_api` (transient API/network failures, usually retriable)
  - `not_found` (missing CE/issue mapping, usually no-op with warning)


## 9) State machine ownership

Linear state transitions are event-driven and idempotent:

- `opened` PR event
  - Owner: release/PR sync workflows
  - Transition: `Todo/In Progress -> In Review` (no-op if already in review/done).
- `ready_for_review` PR event
  - Owner: release/PR sync workflows (future extension point; same transition contract).
  - Transition: `Todo/In Progress -> In Review` (idempotent).
- `merged` PR event
  - Owner: `release-merge-create-tag.yml`
  - Transition: `In Review -> Done` for linked release ticket (no-op when mapping missing).

Failure handling:
- `not_found` and missing-mapping paths are logged and treated as non-blocking no-op when safe.
- API/infra failures fail the run and should be retried using the runbook.
