# Contributing

## Branching model

- `development` is the integration branch.
- `master` is the stable branch.
- Normal work PRs target `development`.
- Release PRs go from `development` to `master`.

## Mandatory Linear-first workflow

1. Start from a Linear issue (`CE-<number>`).
2. Create one branch from `development` using:
   - `codex/CE-<number>-<slug>`
3. Open PR to `development` with title:
   - `[CE-<number>] <short title>`
4. Optional in PR body or commit message:
   - `Closes CE-<number>`
5. Ensure branch ID and PR title ID are the same.

Release PR rule:

- `development -> master` release PRs are exempt from Linear branch/title checks.

Strict enforcement toggle:

- Repo variable `STRICT_LINEAR_ENFORCEMENT` controls strict validation.
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
