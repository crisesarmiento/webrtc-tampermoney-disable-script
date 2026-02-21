# Legacy Variants Changelog

This file tracks historical userscript variants moved into `scripts/legacy/`.

## Baseline and evolution

- `Disable WebRTC Audio Processing Globally-1.4.user.js`
  - Minimal baseline.
  - Hooks `getUserMedia` and `applyConstraints`.
  - Forces W3C processing flags off.

- `M-Game Clean Audio v2-2.0.user.js`
  - Adds M-Game-specific scope and target site matches.
  - Adds `goog*` capture-time flags and quality hints.
  - Adds content hint handling and stream monitoring.

- `M-Game Clean Audio v3-3.0.user.js`
- `M-Game Clean Audio v3.1-3.1.user.js`
  - Adds stronger diagnostics and status commands.
  - Expands SDP and RTCPeerConnection interception.
  - Introduces AudioContext routing experiments.

- `M-Game Clean Audio v4-4.0.user.js`
- `M-Game Clean Audio v5-5.0.user.js`
  - Consolidates W3C and `goog*` behavior.
  - Emphasizes SDP opus tuning for music transport.

- `M-Game Clean Audio v5.2-5.2.user.js`
  - Adds live gain command (`mgameGain`) and stronger debug tooling.
  - Keeps no-DSP baseline while tuning capture/transport behavior.

- `M-Game Clean Audio v6.3 (X Spaces + Atlas) - Comp-Limiter-6.3.user.js`
- `M-Game Clean Audio v6.3 (X Spaces + Atlas) - Compressor-Limiter-6.3.user.js`
- `M-Game Clean Audio v6.3 (X Spaces + Atlas) - Limiter + Robust-6.3.user.js`
  - Adds compressor/limiter variants and extended runtime controls.
  - Introduces constructor wrapping and sender control complexity.
  - Reported regressions documented in `docs/analysis/v6.3-technical-review.md`.

- `M-Game Clean Audio v6.5 (X Spaces + Atlas) - Compressor-Limiter-6.5.user.js`
  - Addresses several v6.3 issues.
  - Keeps DSP-heavy approach that is intentionally deferred for v7 baseline.

- `-New userscript-.user.js`
  - Intermediate local iteration copy.

## Current line

- `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`
  - Re-based on 1.4 principles.
  - Focuses on capture integrity and diagnostics first.
  - Defers advanced DSP and auto-mode until baseline acceptance.
