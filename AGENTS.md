# Agent Contract

This repository uses an OAuth-first Codex + Linear + GitHub workflow.

## Workflow Contract

For normal work PRs into `development`:

- Branch format: `codex/CE-<number>-<slug>`
- PR title format: `[CE-<number>] <short title>`
- Optional magic words in PR body/commits (`Closes/Fixes/Resolves CE-<number>`) must use the same `CE-<number>` as branch/title.

Release exemption:

- `development -> master` PRs are exempt from branch/title enforcement.

Strict toggle:

- `STRICT_LINEAR_ENFORCEMENT=true` enables strict enforcement in `.github/workflows/require-linked-issue.yml`.

## Private Operations Policy

- Treat `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, and `LINEAR_PROJECT_ID` as secrets only.
- Never commit raw Linear team/project IDs, private management identifiers, or internal-only issue URLs to tracked files.
- Use sanitized placeholders (for example: `<LINEAR_ISSUE_URL>`) in docs, examples, and logs.

## PR Review Output Contract

When Codex posts PR reviews, use this exact heading order:

1. `## Summary`
2. `## Critical Issues`
3. `## Suggestions`
4. `## Security Notes`
5. `## Maintainability Notes`

Rules:

- Prefer signal over verbosity.
- In `## Critical Issues`, include concrete file/line references.
- If a section has no findings, write `- None.`.
- Do not propose auto-commit behavior by default.

## Reviewer Source Policy

- Primary AI reviewer source: Codex GitHub app integration (OAuth).
- Keep CodeRabbit disabled for this repository to reduce noise.
- Do not add `openai/codex-action` workflows unless the team explicitly adopts API-key-based CI reviews.
