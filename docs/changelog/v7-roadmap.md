# v8 Roadmap

## v8.0 (current release)

- Transport-first baseline with explicit Opus music SDP guard:
  - `usedtx=0`
  - `stereo=1`, `sprop-stereo=1`
  - `maxplaybackrate=48000`, `sprop-maxcapturerate=48000`
  - `maxaveragebitrate=128000`
  - `useinbandfec=1`
  - remove `cbr`
- Strict stereo gate diagnostics and full gate command:
  - `mgameStereoProbe()`
  - `mgameGateCheck()`
- Runtime profile switching:
  - `strict` (default)
  - `compat_v52` fallback with gain-stage support and live `replaceTrack` best effort.

## v8.1 gate (only after v8.0 acceptance)

Additions are allowed only if v8.0 repeatedly passes continuity and stereo checks:

1. Harden compat live fallback behavior under renegotiation churn.
2. Expand Opus guard observability in `mgameInspect()` for multi-sender sessions.
3. Optional minimal auto-fallback policy (strict -> compat) behind explicit command toggle.

## v8.1 acceptance preconditions

- No recurring dropouts in controlled continuous source tests.
- Stereo probe no longer flags persistent dual-mono collapse on stereo test material.
- `mgameGateCheck()` passes in repeated music-only and voice+music runs.
