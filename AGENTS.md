# Agent Contract

This repository uses an OAuth-first Codex + Linear + GitHub workflow.

## Workflow Contract

For normal work PRs into `development`:

- Branch format: `codex/<TEAM>-<number>-<slug>` (example: `codex/CRIS-123-fix-stereo-gate`)
- PR title format: `[<TEAM>-<number>] <short title>` (example: `[CRIS-123] Fix stereo gate false positive`)
- Optional magic words in PR body/commits (`Closes/Fixes/Resolves <TEAM>-<number>`) must use the same ID as branch/title.
- Set repository default branch to `development` so Codex starts tasks from the integration branch.

Release exemption:

- `development -> main` PRs are exempt from branch/title enforcement.

Strict toggle:

- `STRICT_LINEAR_ENFORCEMENT=true` enables strict enforcement in `.github/workflows/require-linked-issue.yml`.

## Private Operations Policy

- Treat `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, and `LINEAR_PROJECT_ID` as secrets only.
- Never commit raw Linear team/project IDs, private management identifiers, or internal-only issue URLs to tracked files.
- Use sanitized placeholders (for example: `<LINEAR_ISSUE_URL>`) in docs, examples, and logs.
- Keep operational identifiers in GitHub Secrets and local runtime configuration only.
- Keep `STRICT_LINEAR_ENFORCEMENT` configured in repository settings as needed, without storing private IDs in tracked files.

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

## Current Script Naming Policy

- Keep the active userscript path stable as `scripts/current/M-Game Clean Audio.user.js` (no version suffix in `current`).
- Archive versioned release snapshots in `scripts/legacy/` (for example `M-Game Clean Audio v8.0-transport-first.user.js`).
- When this policy changes, update hardcoded references across docs and checks (for example `README.md`, `INSTALL.md`, and `CONTRIBUTING.md`).
