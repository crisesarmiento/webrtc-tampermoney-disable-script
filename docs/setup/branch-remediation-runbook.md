# Branch Remediation Runbook (Strict Linked-Issue Enforcement)

Use this runbook when a PR fails `require-linked-issue` because branch naming does not follow `codex/<KEY>-<number>-<slug>`.

## Core rule

- Do not rename or delete an open PR head branch in place.
- GitHub PR head refs are not safely mutable during remediation and can auto-close or destabilize the PR.

## Standard remediation workflow

1. Identify canonical branch name from the linked issue.
2. Create or update the canonical branch to the same commit SHA as the legacy/non-compliant source branch.
3. Open a replacement PR from the canonical branch into `development`.
4. Copy useful context from the superseded PR (description, checklist, references).
5. Close the superseded PR with a note that links the replacement PR.
6. Continue review and merge on the canonical PR only.

## Automation-first path

If `.github/workflows/auto-create-pr-from-codex-branch.yml` is active:

- Pushes from compatible legacy branch forms (`<key>-<number>-<slug>`, `feature/<key>-<number>-<slug>`, and non-canonical `codex/*` names that include a valid issue ID) are normalized into canonical `codex/<KEY>-<number>-<slug>` branches before PR creation.
- If an open PR already exists for the canonical branch, automation does not create duplicates.

## Verification checklist

- Canonical branch exists and matches expected issue ID/slug.
- Replacement PR title matches `[<KEY>-<number>] <short title>`.
- Optional magic words (if used) match the same ID.
- `require-linked-issue` passes.
- Superseded PR is clearly marked and closed.

## Regression case reference

- Incident pattern: `codex/linear-mention-cris-16-research-strict-userscript-blocker`
- Expected normalization target: `codex/CRIS-16-research-strict-userscript-blocker`
