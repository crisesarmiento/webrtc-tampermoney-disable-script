# Install and Live Test (Atlas + X Spaces)

## 1) Install the v7.0 script in Tampermonkey

Use the script file:

- `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`

### Option A: Import via Tampermonkey UI (recommended)

1. Open Tampermonkey dashboard in Atlas browser.
2. Click `Utilities` -> `Import from file`.
3. Select:
   - `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`
4. Save and ensure script is **Enabled**.

### Option B: Paste script manually

1. Tampermonkey -> `Create a new script`.
2. Replace all content with the file contents above.
3. Save and ensure script is **Enabled**.

## 2) Atlas runtime setup

1. Open Atlas: `https://chatgpt.com/atlas/`.
2. Join or start an X Space flow.
3. In microphone selection, confirm:
   - `Default - M-Game RGB Dual Stream`
4. Start publishing audio.

## 3) Verify script loaded

Open DevTools Console and run:

```js
mgameStatus()
```

Expected:

- `version: "7.0-baseline"`
- Non-empty `captureInputLabel` after capture starts
- `senderSummary` entries when publishing
- W3C constraints shown as supported where available

## 4) Live diagnostics sequence (Atlas)

Run in this order while actively publishing:

```js
mgameInspect()
```

- Confirms active PeerConnections and audio sender rows.

```js
await mgameStereoProbe(1500)
```

- Checks runtime stereo integrity indicator.
- If warning says channels are nearly identical, treat as dual-mono risk.

```js
await mgameDropoutProbe(500, 12000)
```

- Looks for stalled outbound RTP windows.
- Target: `dropouts: 0` for continuous source material.

```js
await mgameStats(2000, 20000)
```

- Tracks outbound bitrate continuity across 20s.

```js
await mgameCodecProbe(1200, 12000)
```

- Captures outbound codec and transport snapshots over time.

## 5) Manual listening checklist

1. Continuous music-only source for at least 30s.
   - Expect no audible dropouts.
2. Voice-only speaking test for at least 20s.
   - Expect stable level and clarity.
3. Voice + music overlap for at least 30s.
   - Expect no sudden mute/gaps.
4. Rejoin or renegotiate session.
   - Re-run `mgameStatus()` and `mgameInspect()`.

## 6) Capture and compare regression metrics

If you record a new WAV evidence file, run:

```bash
bash scripts/tools/analyze_capture_metrics.sh "/absolute/path/to/new-capture.wav"
```

Baseline reference file:

- `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`

Target improvements vs baseline:

- Higher integrated loudness than `-38.21 LUFS`
- Fewer/no silence windows during continuous playback
- Better L/R separation than near-noise-floor residual

## 7) Quick rollback

If something breaks during live session:

1. Disable the `v7.0-baseline` script in Tampermonkey.
2. Reload Atlas tab.
3. Re-test with previous known script from:
   - `scripts/legacy/`
