# Linear + GitHub + Codex Automation

This setup provides:

1. GitHub issue opened -> Linear issue created automatically.
2. Linear assignment event -> Codex dispatch workflow and automatic Linear transition to `In Progress`.
3. Codex work PR lifecycle automation:
   - auto-create PR from `codex/<KEY>-*` branches
   - move Linear issue to `In Review` when PR opens or becomes ready
4. Release tracking in Linear for `development -> main` PRs and `v*` tags.
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
- Variable: `LINEAR_ALLOWED_KEYS`
  - Controls allowed issue key prefixes across branch/title validation and PR-state sync workflows.
  - Transition value: `CRIS,CE`
  - Final value: `CRIS`

Note:

- `OPENAI_API_KEY` is not required for this OAuth-first setup.

## 1.1) Branch protection/rulesets (manual GitHub configuration)

Configure repository branch protections (or rulesets) with these minimums:

- `main`
  - Require pull request before merging.
  - Require status checks to pass before merging:
    - `validate`
    - `require-linked-issue`
    - `codex-review`
  - Disallow direct pushes.
- `development`
  - Require pull request before merging.
  - Disallow force pushes.

If release automation must push `VERSION` and `CHANGELOG.md` to `main`, allow `github-actions[bot]` as an explicit bypass actor for that rule.

## 2) PR linking conventions (Linear-first)

Required for normal work PRs:

- Branch: `codex/CRIS-<number>-<slug>`
- Title: `[CRIS-<number>] <short title>`
- Branch ID and title ID must match.
- GitHub repository default branch should be `development` so Codex starts new task work from the integration branch.

Compatibility bridge:

- If Linear/Codex starts work from `<team>-<number>-<slug>` or `feature/<team>-<number>-<slug>`, automation normalizes it to `codex/<KEY>-<number>-<slug>` and creates/updates the PR from the canonical branch when `<KEY>` is in `LINEAR_ALLOWED_KEYS`.

Optional:

- Magic word in PR body/commit, for example: `Closes CRIS-123`
- If used, it must match the same issue ID in branch/title.

Release exemption:

- `development -> main` release PRs are exempt from branch/title enforcement.

## 3) Existing Linear sync workflows

- `.github/workflows/sync-github-issue-to-linear.yml`
  - Trigger: `issues.opened`
  - Creates Linear issue and comments link back on GitHub issue.

- `.github/workflows/codex-linear-assignment-dispatch.yml`
  - Trigger: `repository_dispatch` (`linear_issue_assigned_to_codex`) and manual dispatch.
  - Records Codex trigger behavior and moves matching Linear issue to `In Progress`.

- `.github/workflows/sync-pr-state-to-linear.yml`
  - Trigger: PR `opened`, `reopened`, and `ready_for_review` into `development`.
  - Moves matching Linear issue (`<KEY>-*`, allowlisted by `LINEAR_ALLOWED_KEYS`) to `In Review` for active review state tracking.

- `.github/workflows/auto-create-pr-from-codex-branch.yml`
  - Trigger: `push` to `codex/**`, `<team>-*`, and `feature/<team>-*` branches.
  - Canonicalizes compatible legacy branch names (`<team>-*`, `feature/<team>-*`) to `codex/<KEY>-*` and keeps canonical branch refs updated to latest SHA.
  - Auto-creates a PR to `development` from canonical `codex/<KEY>-*` branch if one does not already exist when `<KEY>` is allowlisted.

- `.github/workflows/sync-release-pr-to-linear.yml`
  - Trigger: `pull_request` to `main` when `head == development`.
  - Upserts/creates Linear release tracking ticket for the release PR.

- `.github/workflows/release-merge-create-tag.yml`
  - Trigger A: release PR `development -> main` when merged.
  - Trigger B: manual `workflow_dispatch` with `pr_number` for backfill.
  - Resolves next `v*` semver tag from PR labels (`semver:major|minor|patch`) or explicit version in PR title/body.
  - Commits `VERSION` and `CHANGELOG.md`, creates tag and GitHub Release with generated notes, upserts Linear tag ticket, and closes the release PR Linear ticket to `Closed` when available (fallback: `Done`/first completed state).

- `.github/workflows/codex-review.yml`
  - Trigger: PR opened/edited/reopened/synchronize/ready-for-review events.
  - Reads Codex OAuth review feedback from PR reviews/comments, posts a gate summary comment, and fails for high-risk patterns.
  - Provides required status check name `codex-review` (configure in branch protection/rulesets).

- `.github/workflows/sync-ce-pr-merge-to-linear-done.yml`
  - Trigger A: `pull_request.closed` for merged PRs into `development` when `head` starts with `codex/`.
  - Trigger B: manual `workflow_dispatch` for backfill.
  - Extracts Linear identifiers from PR title/body/head branch, normalizes and deduplicates all matches, then marks each matching Linear issue as `Done` (idempotent per issue).
  - `workflow_dispatch` supports one or more identifiers via `ce_identifiers` (space/comma/newline separated), optionally combined with `pr_number`.

- `.github/workflows/sync-release-tag-to-linear.yml`
  - Trigger: `push` tags matching `v*`.
  - Creates Linear release tracking ticket for manual/published tag push events.

## 4) Codex review model (OAuth app-based + CI gate)

Codex PR reviews are provided by the Codex GitHub integration (OAuth). CI gate workflow `codex-review.yml` consumes Codex feedback and enforces high-risk pattern checks.

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
  - `linear_sync linear_id=<identifier> ce_id=<identifier> status=<updated|already_done|not_found|failed> reason=<optional>`
- Use this output for audit, alerting, and manual replay triage.

## 8) Workflow reliability controls

- `validate.yml` enforces workflow quality checks via:
  - `actionlint` (YAML + workflow linting)
  - shell strict mode checks for helper scripts
  - PR payload smoke tests for branch/title + Linear linkage cases
- Linear API error handling should classify failures into:
  - `infra_api` (transient API/network failures, usually retriable)
  - `not_found` (missing Linear issue mapping, usually no-op with warning)


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
  - Transition: `In Review -> Closed` for linked release ticket when that status exists (fallback: `Done`/completed; no-op when mapping missing).

Failure handling:
- `not_found` and missing-mapping paths are logged and treated as non-blocking no-op when safe.
- API/infra failures fail the run and should be retried using the runbook.
