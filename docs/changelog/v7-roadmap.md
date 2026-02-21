# v7 Roadmap

## v7.0 (current baseline)

- Build from 1.4 architecture.
- No compressor, limiter, soft clipper, or auto mode.
- Focus on capture integrity, sender stability, and diagnostics.

## v7.1 gate (only after v7.0 acceptance)

Additions are allowed only if v7.0 passes continuity and stereo checks:

1. Reintroduce gain-only stage with module-scope GainNode and live-safe updates.
2. Keep static transparent default mode.
3. Add auto-mode prototype behind explicit command toggle only.

## v7.1 acceptance preconditions

- No recurring dropouts in controlled continuous source tests.
- Stereo probe no longer flags persistent dual-mono collapse on stereo test material.
- Outbound sender stats remain stable without repeated forced reconfiguration loops.
