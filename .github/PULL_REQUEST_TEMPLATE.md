## Summary

Describe what changed and why.

## Linear Issue

- Linear ID: `CE-<number>`
- Branch format: `codex/CE-<number>-<slug>`
- PR title format: `[CE-<number>] <short title>`
- Optional magic word example: `Closes CE-<number>`

## Scope

- [ ] Userscript logic (`scripts/current`)
- [ ] Legacy archive (`scripts/legacy`)
- [ ] Docs (`docs/`, `README.md`, `INSTALL.md`)
- [ ] Evidence (`evidence/`)
- [ ] Tooling/CI (`scripts/tools`, `.github/workflows`)

## Validation

List exact commands run and key results.

```bash
node --check "scripts/current/M-Game Clean Audio v7.0-baseline.user.js"
bash "scripts/tools/analyze_capture_metrics.sh" "evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav"
```

## Checklist

- [ ] Branch and PR title include the same Linear ID
- [ ] Local checks pass (syntax + metrics)
- [ ] Security or behavior-impacting risks are documented
- [ ] Screenshot/evidence attached when UI/audio behavior changed
