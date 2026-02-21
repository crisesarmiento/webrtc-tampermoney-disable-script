# M-Game WebRTC Clean Audio Toolkit

Tampermonkey-first toolkit for stabilizing Atlas/X Spaces browser capture with the RODE M-Game RGB Dual.

This repository focuses on one priority for `v7.0`: **capture integrity first**.

- No unnecessary DSP in baseline
- Strong diagnostics for dropouts and dual-mono detection
- Reproducible audio evidence workflow

## What Is Included

- Current script:
  - `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`
- Legacy script archive:
  - `scripts/legacy/`
- Capture metrics tool:
  - `scripts/tools/analyze_capture_metrics.sh`
- Setup, validation, and changelog docs:
  - `docs/`
  - `docs/setup/linear-github-codex-automation.md`
- Evidence set (screenshots + WAV):
  - `evidence/`

## Quick Start

1. Import `scripts/current/M-Game Clean Audio v7.0-baseline.user.js` into Tampermonkey.
2. Enable the script and reload Atlas/X tab.
3. In Atlas, select mic input:
   - `Default - M-Game RGB Dual Stream`
4. Open DevTools Console and verify:

```js
mgameStatus()
```

For full install and live test flow, use `INSTALL.md`.

For Linear/GitHub/Codex automation setup, use:

- `docs/setup/linear-github-codex-automation.md`

## Runtime Diagnostics

Available console commands in `v7.0-baseline`:

- `mgameStatus()`
- `mgameInspect()`
- `mgameStats(intervalMs, durationMs)`
- `mgameDropoutProbe(intervalMs, durationMs)`
- `mgameCodecProbe(intervalMs, durationMs)`
- `mgameStereoProbe(sampleMs)`

These commands help verify:

- Outbound sender stability
- Runtime bitrate continuity
- Runtime codec/transport continuity
- Stereo integrity vs dual-mono collapse
- Dropout windows during live publish

## Capture Regression Analysis

Run metrics on any WAV capture:

```bash
bash scripts/tools/analyze_capture_metrics.sh "/absolute/path/to/capture.wav"
```

The script reports:

- Stream/format metadata
- EBU R128 loudness + true peak
- Mean/max volume distribution
- Silence windows (`-50 dB`, `>=250ms`)
- L-R residual (dual-mono check)
- Band energy snapshots (0-4k, 4-8k, 8-12k, 12k+)

## Baseline Evidence Snapshot

From `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`:

- Integrated loudness around `-38.21 LUFS`
- True peak around `-20.87 dBFS`
- Silence windows detected in a continuous-content segment
- L-R residual near `-91 dB` (dual-mono symptom)

These findings define the `v7.0` goal: **continuous, properly leveled, stereo-preserving capture path**.

## v7 Roadmap

- `v7.0` (current): baseline integrity + diagnostics
- `v7.1` (gated): optional gain-only stage, then opt-in auto-mode prototype

See `docs/changelog/v7-roadmap.md` for gating criteria.

## Project Context Images

![M-Game Setup](evidence/screenshots/M%20Game%20RGB.png)
![M-Game Routing](evidence/screenshots/M%20Game%20RGB_Routing.png)

## Repository Structure

```text
scripts/
  current/
  legacy/
  tools/
docs/
  analysis/
  setup/
  validation/
  changelog/
evidence/
  audio/
  screenshots/
```

## License

MIT, see `LICENSE`.
