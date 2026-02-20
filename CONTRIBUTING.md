# Contributing

## Branching model

- `development` is the integration branch.
- `master` is the stable branch.
- Open PRs into `master` from `development` unless discussed otherwise.

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
- Explain behavior changes and risks.
- Include diagnostics output for audio-impacting changes.
- Keep legacy files in `scripts/legacy` unchanged unless there is a specific archival reason.
