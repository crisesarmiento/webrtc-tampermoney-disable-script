# M-Game WebRTC Clean Audio Toolkit

Tampermonkey-first toolkit for stabilizing Atlas/X Spaces browser capture with the RODE M-Game RGB Dual.

This repository tracks two active tracks:

- `v11.0` debug-enabled minimal music-first WebRTC constraints hardener for Atlas/X
- `v9.0` standalone strict WebRTC processing blocker

## What Is Included

- Current scripts:
  - `scripts/current/M-Game Clean Audio.user.js`
  - `scripts/current/WebRTC Strict Blocker.user.js`
  - `scripts/current/Disable WebRTC Audio Processing v9.0-strict.user.js`
- Legacy script archive:
  - `scripts/legacy/`
- Capture metrics tool:
  - `scripts/tools/analyze_capture_metrics.sh`
- Setup, validation, and changelog docs:
  - `docs/`
  - `docs/setup/linear-github-codex-automation.md`
- Evidence set (screenshots + WAV):
  - `evidence/`

> Maintainer reminder: keep `scripts/current/M-Game Clean Audio.user.js` as the stable import path, and archive versioned releases under `scripts/legacy/`.

## Quick Start

1. Import one of the current scripts into Tampermonkey:
   - `scripts/current/M-Game Clean Audio.user.js` (v11 DEBUG minimal constraints hardener)
   - `scripts/current/Disable WebRTC Audio Processing v9.0-strict.user.js` (standalone strict blocker)
2. Enable the script and reload the target tab.
3. For Atlas transport testing, select mic input:
   - `Default - M-Game RGB Dual Stream`
4. Open DevTools Console and verify install log:

```text
"[M-Game DEBUG] ✅ v11 DEBUG script loaded and active"
```

For full install/use/rollback documentation (including domain scope and known breakage), use `INSTALL.md`.

For strict-blocker install and validation flow, use:

- `docs/setup/webrtc-strict-blocker-install.md`
- `docs/validation/v9-strict-blocker-validation.md`

For Linear/GitHub/Codex automation setup, use:

- `docs/setup/linear-github-codex-automation.md`

## Workflow

- Always start by syncing `development` locally before new feature work:
  - `git checkout development`
  - `git pull origin development`
- Branch format: `codex/CRIS-<number>-<slug>`
- PR title format: `[CRIS-<number>] <short title>`
- Optional magic word in PR body/commit: `Closes CRIS-<number>`
- Keep the same `CRIS-<number>` in branch, title, and any magic-word line.
- Keep repository default branch set to `development` so Codex starts from the integration branch.
- Keep the feature branch updated with `development` before requesting review so the PR reflects the latest integration baseline.
- During migration, allowlist can be set via repository variable `LINEAR_ALLOWED_KEYS` (`CRIS,CE` then cut over to `CRIS`).
- OAuth-based Codex PR review is configured via GitHub app integration (outside CI workflow files).

Example:

```text
Branch: codex/CRIS-321-fix-stereo-gate
Title:  [CRIS-321] Fix stereo gate false positive
Body:   Closes CRIS-321
```

## Current Scope and Constraints

The current userscript scope for this guide is limited to:

- `https://x.com/*`
- `https://*.x.com/*`
- `https://twitter.com/*`
- `https://*.twitter.com/*`
- `https://chatgpt.com/*`
- `https://twimg.com/*`
- `https://*.twimg.com/*`
- `https://pbs.twimg.com/*`
- `https://video.twimg.com/*`

Known constraints and rollback guidance are documented in `INSTALL.md`:

- Install flow
- Domain scope
- Explicit limitations and known breakage
- Full rollback (disable userscript and reload)

## Runtime Validation

The v11 script keeps the minimal hardening behavior and adds DEBUG logging around media APIs. It does not expose custom `mgame*` console commands.

Validate behavior using:

- `chrome://webrtc-internals` when available (confirm audio processing constraints are disabled)
- Controlled A/B runs when internals are unavailable (Atlas environments)

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

## Release Snapshot

- Latest release: `v11.0.0` (published 2026-03-15)
- Previous tags: `v8.2`, `v8.1`, `v8.0.0`

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
