# Install, Scope, and Rollback Guide

This guide documents the current Tampermonkey workflow for the active minimal userscript.

Current script path:

- `scripts/current/M-Game Clean Audio.user.js`

For the standalone v9 strict blocker workflow, use:

- `docs/setup/webrtc-strict-blocker-install.md`

The v10 script is intentionally minimal: it only hardens WebRTC audio constraints to disable browser-side post-processing.

---

## 1) Install flow

### Prerequisites

- Chromium-based browser with Tampermonkey installed.
- Access to one of the supported domains (listed in [Domain scope](#2-domain-scope)).
- Disable conflicting scripts during validation:
  - `WebRTC Strict Blocker (Atlas + X)`
  - `Disable WebRTC Audio Processing v9.0-strict`

### Option A: Import from file (recommended)

1. Open the Tampermonkey dashboard.
2. Go to **Utilities** -> **Import from file**.
3. Choose:
   - `scripts/current/M-Game Clean Audio.user.js`
4. Save and verify the script is **Enabled**.

### Option B: Create manually

1. Tampermonkey -> **Create a new script**.
2. Replace editor content with the file above.
3. Save and verify the script is **Enabled**.

### Verify installation

1. Open a supported site tab and reload it.
2. Open DevTools Console.
3. Confirm this log appears once:

```text
[M-Game v10 Minimal] Installed minimal WebRTC constraints hardener.
```

---

## 2) Domain scope

The script uses metadata `@match` rules for these domains:

- `https://x.com/*`
- `https://*.x.com/*`
- `https://twitter.com/*`
- `https://*.twitter.com/*`
- `https://chatgpt.com/*`
- `https://twimg.com/*`
- `https://*.twimg.com/*`
- `https://pbs.twimg.com/*`
- `https://video.twimg.com/*`

Practical implications:

- Core usage remains on `x.com`, `twitter.com`, and `chatgpt.com`.
- Extended X/Twitter host coverage avoids missing frame/embed capture paths.
- Behavior is identical across all matched hosts (constraint hardening only).

---

## 3) What the script changes

The script patches only two APIs:

1. `navigator.mediaDevices.getUserMedia`
2. `MediaStreamTrack.prototype.applyConstraints` (audio tracks only)

It forces these constraints to `false`:

- `echoCancellation`
- `noiseSuppression`
- `autoGainControl`
- `voiceIsolation` (when supported)
- Legacy `goog*` flags at:
  - top-level audio constraint object
  - `audio.advanced[]`
  - `audio.mandatory`
  - `audio.optional[]`

Explicit non-goals:

- No SDP munging
- No `RTCPeerConnection` wrapping
- No sender bitrate/channel forcing
- No gain-stage DSP/retrack pipeline

---

## 4) Validation matrix

1. Apply M-Game baseline routing:
   - `Chat Audio Source = Stream PC`
   - `Game Audio Source = Stream PC`
2. Baseline pass with mic DSP OFF (`EQ/Compressor/Noise Gate/De-esser/HPF` off; Boost only if needed).
3. Run A/B with identical routing:
   - Script OFF + DSP OFF
   - Script ON + DSP OFF
   - Script ON + DSP ON (preferred voice profile)
4. Compare Atlas and X Spaces outcomes.
5. If `chrome://webrtc-internals` is available, confirm processing flags are disabled.
6. If internals are not available (Atlas restrictions), rely on controlled A/B subjective quality and level stability.

---

## 5) Explicit limitations

1. Browser/engine behavior differs; some apps may still override constraints later.
2. This script only handles browser-side WebRTC constraints, not hardware routing or driver-level effects.
3. Native desktop apps are out of scope.
4. Site updates can change capture paths and require re-validation.

---

## 6) Rollback and recovery

### Full rollback

1. Disable `M-Game Clean Audio` in Tampermonkey.
2. Reload affected tabs.
3. Re-test publishing.

### Alternate fallback

If needed, switch temporarily to another script in:

- `scripts/current/`
- `scripts/legacy/`

---

## 7) Validation evidence capture

For audio capture regression checks:

```bash
bash scripts/tools/analyze_capture_metrics.sh "/absolute/path/to/capture.wav"
```

Baseline reference capture:

- `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`
