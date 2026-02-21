# Technical Knowledge Base (Historical Reference)

Based on: **M-Game Clean Audio v6.3 (X Spaces + Atlas) - Compressor/Limiter** and earlier versions.

## Scope Note

This file is a historical reference document, originally centered around v5.2/v6.x behavior.
It is **not** the canonical source for current baseline behavior in this repository.

For current baseline behavior, see:
- `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`
- `docs/changelog/v7-roadmap.md`
- `docs/analysis/v6.3-technical-review.md`

## What the Script Does (4 Interception Layers)

1. **getUserMedia constraints**
- Injects W3C constraints (`echoCancellation`, `autoGainControl`, `noiseSuppression` = `false`).
- Injects Chrome legacy `goog*` constraints at capture-time.
- `goog*` flags are meaningful at `getUserMedia` capture-time.

2. **applyConstraints interception**
- Intercepts track-level `applyConstraints` calls.
- Forces W3C processing flags back to disabled.
- Typically does not rely on `goog*` at this stage.

3. **SDP munging (Opus tuning)**
- Adjusts Opus fmtp parameters to improve music transport quality.
- Enforces stereo/fullband preferences where possible.

4. **Gain / chain controls (version-dependent)**
- Some versions expose runtime gain or processing controls.
- Later v6 variants added dynamics stages; v7 baseline defers DSP by default.

## Critical SDP Parameters (What Each Does)

| Parameter | Value | Why |
|---|---:|---|
| `maxplaybackrate` | `48000` | Signals fullband playback capability to avoid narrowband behavior. |
| `sprop-maxcapturerate` | `48000` | Signals fullband capture capability on the sender side. |
| `maxaveragebitrate` | `128000` | Raises target bitrate beyond default voice-oriented levels. |
| `stereo` | `1` | Indicates decoder can receive stereo. |
| `sprop-stereo` | `1` | Indicates sender intends to send stereo. |
| `usedtx` | `0` | Disables DTX to reduce voice-style dropouts on quiet music content. |
| `useinbandfec` | `1` | Enables in-band FEC for packet loss resilience. |
| `cbr` | removed | Prefer VBR behavior for complex program material. |

## Opus Codec Modes (Critical Understanding)

- **SILK mode**: speech-focused, narrower effective bandwidth.
- **CELT mode**: music-focused, wider bandwidth/fullband behavior.
- **Hybrid mode**: mixed behavior; acceptable fallback depending on network/encoder decisions.

## Chrome `goog*` Constraints (Historical)

These flags are relevant to capture-time behavior in Chromium-derived engines.

| Flag | What it does to music-oriented capture |
|---|---|
| `googEchoCancellation` | Can introduce phase artifacts and voice bias. |
| `googAutoGainControl` | Can pump levels unnaturally. |
| `googAutoGainControl2` | Secondary dynamics shaping, can flatten program material. |
| `googNoiseSuppression` | Can muffle non-voice content. |
| `googNoiseSuppression2` | Additional suppression/gating behavior. |
| `googHighpassFilter` | Can reduce bass/low-end energy. |
| `googTypingNoiseDetection` | Voice/percussion false positives possible. |
| `googDucking` | Can lower level when voice-like activity is detected. |

## What `contentHint='music'` Does

Sets track hint toward audio/music-optimized behavior (implementation dependent), helping reduce voice-only optimization bias.

## Version History (Condensed)

- **v1-v3**: early experiments; some parameter sets were rejected by platform behavior.
- **v4**: improved DTX handling; still had constraint-stage edge cases.
- **v5/v5.1/v5.2**: refined W3C vs `goog*` handling and SDP tuning, added runtime gain tools.
- **v6.x**: introduced robust variants and DSP options; also introduced identified regressions in specific variants.
- **v7.0 baseline (current project baseline)**: capture-integrity-first, diagnostics-first, DSP deferred by default.

## Known Constraints & Gotchas

- Platform-side behavior (X/Atlas/WebRTC stack) can ignore/rewrite hints.
- Some aggressive parameter combinations may be rejected.
- Stereo behavior depends on end-to-end route, not only one parameter.
- Constructor wrapping note is **version-dependent**:
  - early versions often used prototype-only hooks,
  - some v6 variants wrapped `RTCPeerConnection` constructor.

## Console Commands (Version-Dependent)

Historical examples:
- `mgameStatus()`
- `mgameGain(1.0)`
- `mgameGain(1.5)`
- `mgameGain(0.7)`

Current baseline (`v7.0`) commands:
- `mgameStatus()`
- `mgameInspect()`
- `mgameStats(intervalMs, durationMs)`
- `mgameStereoProbe(sampleMs)`
- `mgameDropoutProbe(intervalMs, durationMs)`

## Key References

- RFC 7587 (Opus RTP payload and fmtp semantics)
- W3C Media Capture and Streams specs/issues
- Chromium/WebRTC implementation notes and bug threads
