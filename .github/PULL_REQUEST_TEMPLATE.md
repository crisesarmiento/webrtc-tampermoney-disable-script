## Summary

Describe what changed and why.

## Linked Issue

- Issue: #<id>
- Closing keyword (required): `Closes #<id>`

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

## Audio Risk Checklist

- [ ] Issue was created before implementation started
- [ ] No new forced DSP stages added to `v7.0-baseline`
- [ ] No periodic `setParameters()` spam loops introduced
- [ ] Stereo integrity behavior considered
- [ ] Dropout behavior considered

## Screenshots / Evidence

Attach console output or sample capture comparisons when relevant.
