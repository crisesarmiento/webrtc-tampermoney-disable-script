# Linear Sync Runbook

## Quick checks

1. Verify secrets are present in repository settings:
   - `LINEAR_API_KEY`
   - `LINEAR_TEAM_ID`
   - `LINEAR_PROJECT_ID`
2. Verify workflow run input payload and event type.
3. Confirm the run log contains `linear_sync ce_id=... status=...` summary lines.

## Re-trigger procedures

- PR sync workflows: re-run the failed workflow from GitHub Actions run page.
- Release merge tagging: use `workflow_dispatch` for `release-merge-create-tag.yml` with `pr_number`.
- Assignment dispatch: replay the same `repository_dispatch` payload.

## Failure classification

- `infra_api`
  - Symptoms: network errors, HTTP 5xx, GraphQL transport failures.
  - Action: retry and monitor API status.
- `not_found`
  - Symptoms: missing mapping comment, missing CE/issue lookup result.
  - Action: verify issue references; no-op is expected in some branches.
- `failed`
  - Symptoms: workflow script validation/contract failure.
  - Action: fix payload, branch/title contract, or secret contract.

## Recover stale Linear states

1. Locate affected CE ticket.
2. Re-run the owning workflow event path (`opened`, `ready_for_review`, `merged`).
3. If needed, update state manually in Linear and leave a GitHub comment with the correction.
4. Keep the PR/issue mapping comments unchanged to preserve idempotent upserts.
