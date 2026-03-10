# Contributing

## Branching model

- `development` is the integration branch.
- `main` is the stable branch.
- Normal work PRs target `development`.
- Release PRs go from `development` to `main`.

## Mandatory Linear-first workflow

1. Start from a Linear issue (`CRIS-<number>`, for example `CRIS-123`).
2. Sync local `development` to the latest remote before creating your feature branch:
   - `git checkout development`
   - `git pull origin development`
3. Create one branch from the updated `development` using:
   - `codex/CRIS-<number>-<slug>`
4. Open PR to `development` with title:
   - `[CRIS-<number>] <short title>`
5. Keep your branch current with `development` while work is in progress (rebase or merge) so the PR reflects the latest integration branch state.
6. Optional in PR body or commit message:
   - `Closes CRIS-<number>`
7. Ensure branch ID and PR title ID are the same.

Release PR rule:

- `development -> main` release PRs are exempt from Linear branch/title checks.

Strict enforcement toggle:

- Repo variable `STRICT_LINEAR_ENFORCEMENT` controls strict validation.
- Repo variable `LINEAR_ALLOWED_KEYS` controls allowed issue key prefixes during migration (`CRIS,CE` transition; `CRIS` final).
- Default behavior is strict (`true`).

## Current script naming policy

- Keep a stable import path in `scripts/current/` as `M-Game Clean Audio.user.js` (no version suffix).
- When releasing a new version, archive the previous versioned artifact under `scripts/legacy/` and ensure docs/checks still reference the stable current path.

## Local checks before PR

Run:

```bash
node --check "scripts/current/M-Game Clean Audio.user.js"
bash "scripts/tools/analyze_capture_metrics.sh" "evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav"
```

## PR expectations

- Use the PR template.
- Keep scope tied to one Linear issue.
- Explain behavior changes and risks.
- Include diagnostics output for audio-impacting changes.
- Keep legacy files in `scripts/legacy` unchanged unless there is a specific archival reason.

## AI review policy

- Codex GitHub app integration (OAuth) is the single AI PR reviewer for this repo.
- Disable CodeRabbit for this repository.
- Keep review output aligned with `AGENTS.md`.
