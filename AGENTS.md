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

## Private Operations Policy

- Do not commit internal management metadata (tokens, team/project IDs, issue URLs, or private workflow mappings).
- Keep operational identifiers in GitHub Secrets and local runtime configuration only.
- For this repository, keep Linear operational values private via secrets:
  - `LINEAR_API_KEY`
  - `LINEAR_TEAM_ID`
  - `LINEAR_PROJECT_ID`
- Keep `STRICT_LINEAR_ENFORCEMENT` configured in repository settings as needed, without storing private IDs in tracked files.
