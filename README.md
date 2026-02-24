# M-Game WebRTC Clean Audio Toolkit

Tampermonkey-first toolkit for stabilizing Atlas/X Spaces browser capture with the RODE M-Game RGB Dual.

This repository is now tracking the `v8.1` release baseline: **music transport integrity first, with gated hardening landed**.

It also includes a separate `v9.0` minimum WebRTC strict-blocker track for selected domains (`chatgpt.com`, `x.com`, `twitter.com`).

- Transport-first baseline (Opus music SDP guard + sender hints)
- Strict stereo gate diagnostics
- One-command `v5.2` compatibility fallback profile
- Reproducible audio evidence workflow

## What Is Included

- Current script:
  - `scripts/current/M-Game Clean Audio.user.js`
- Separate strict WebRTC blocker script:
  - `scripts/current/WebRTC Strict Blocker.user.js`
- Legacy script archive:
  - `scripts/legacy/`
- Capture metrics tool:
  - `scripts/tools/analyze_capture_metrics.sh`
- Setup, validation, and changelog docs:
  - `docs/`
- Evidence set (screenshots + WAV):
  - `evidence/`

> Maintainer reminder: keep `scripts/current/M-Game Clean Audio.user.js` as the stable import path, and archive versioned releases under `scripts/legacy/`.

## Quick Start

1. Import `scripts/current/M-Game Clean Audio.user.js` into Tampermonkey.
2. Enable the script and reload Atlas/X tab.
3. In Atlas, select mic input:
   - `Default - M-Game RGB Dual Stream`
4. Open DevTools Console and verify:

```js
mgameStatus()
```

For full install and live test flow, use `INSTALL.md`.

For the standalone strict WebRTC blocker install and test flow, use:

- `docs/setup/webrtc-strict-blocker-install.md`

## Workflow

- Branch format: `codex/CE-<number>-<slug>`
- PR title format: `[CE-<number>] <short title>`
- Optional magic word in PR body/commit: `Closes CE-<number>`
- Keep the same `CE-<number>` in branch, title, and any magic-word line.
- OAuth-based Codex PR review is configured via GitHub app integration (outside CI workflow files).

Example:

```text
Branch: codex/CE-321-fix-stereo-gate
Title:  [CE-321] Fix stereo gate false positive
Body:   Closes CE-321
```

## Runtime Diagnostics

Available console commands in `v8.0-transport-first`:

- `mgameStatus()`
- `mgameInspect()`
- `mgameProfile([name])`
- `mgameGain([value])`
- `mgameStats(intervalMs, durationMs)`
- `mgameDropoutProbe(intervalMs, durationMs)`
- `mgameCodecProbe(intervalMs, durationMs)`
- `mgameStereoProbe(sampleMs)`
- `mgameGateCheck(intervalMs, durationMs)`

These commands help verify:

- Outbound sender stability
- Runtime bitrate continuity
- Runtime codec/transport continuity
- Stereo integrity vs dual-mono collapse
- Dropout windows during live publish
- Opus guard status (`usedtx=0`, stereo/fullband settings)
- Strict-mode pass/fail with compat fallback guidance

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

These findings define the `v8.0` goal: **continuous, stereo-intact, transport-stable music capture**.

## v8 Roadmap

- `v8.0`: transport-first + strict stereo gates + `compat_v52` fallback
- `v8.1` (released): gated hardening promoted from `development` to `master` via release tag `v8.1`

See `docs/changelog/v7-roadmap.md` for gating criteria.

For v9 strict-blocker release planning, see:

- `docs/changelog/v9-roadmap.md`

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
