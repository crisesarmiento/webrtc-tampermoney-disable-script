# Contributing

## Branching model

- `development` is the integration branch.
- `master` is the stable branch.
- Open PRs into `development` from issue branches.
- Release PRs go from `development` to `master`.

## Mandatory issue-first workflow

Every discovered defect or enhancement must be tracked before implementation.

1. Open (or confirm) a GitHub issue.
2. Create one issue branch from `development`:
   - Human branch: `issue/<id>-<slug>`
   - Agent branch: `codex/issue-<id>-<slug>`
3. Implement only that issue scope in the branch.
4. Open PR from issue branch to `development`.
5. Include a closing keyword in PR body: `Closes #<id>`.
6. Merge PR to `development`; GitHub closes the linked issue.
7. Promote `development` to `master` via release PR.

Release PR rule:
- `development -> master` release PRs are exempt from issue-branch checks in `require-linked-issue`.
- Issue-first enforcement still applies to normal work PRs (issue branches into `development`).

## Project priorities

For the current line (`v7.0-baseline`):

1. Capture integrity first (continuity, level, stereo behavior).
2. Diagnostics and reproducibility.
3. Avoid adding DSP complexity unless explicitly gated.

## Local checks before PR

Run:

```bash
node --check "scripts/current/M-Game Clean Audio v7.0-baseline.user.js"
bash "scripts/tools/analyze_capture_metrics.sh" "evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav"
```

## PR expectations

- Use the PR template.
- Link the issue explicitly and include `Closes #<id>`.
- Confirm the issue existed before implementation.
- Explain behavior changes and risks.
- Include diagnostics output for audio-impacting changes.
- Keep legacy files in `scripts/legacy` unchanged unless there is a specific archival reason.
