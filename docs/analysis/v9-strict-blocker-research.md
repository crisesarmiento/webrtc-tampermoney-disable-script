# v9 Strict Blocker Research Notes

## Goal

Create a standalone userscript that strictly disables WebRTC voice processing without depending on transport, SDP, or Atlas/X-specific runtime hooks.

## Research Summary

- Modern Chromium paths can re-introduce browser processing when sites call `MediaStreamTrack.applyConstraints()` after initial capture.
- Some sites still pass legacy `goog*` flags; preserving explicit `false` values for those flags improves compatibility with legacy wrappers.
- `voiceIsolation` is optional and browser-dependent, so v9 applies it only when supported.

## Design Decisions

1. Intercept both `navigator.mediaDevices.getUserMedia()` and `MediaStreamTrack.prototype.applyConstraints()`.
2. Normalize `audio: true` requests to explicit objects before hardening flags.
3. Avoid `exact` constraint usage to reduce overconstraint failures.
4. Provide a tiny runtime status function (`webrtcBlockerV9Status()`) for operator verification.

## Out of Scope

- Transport diagnostics and Opus SDP mutation from v8 transport-first builds.
- Atlas-only routing assumptions.
