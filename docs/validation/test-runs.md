# Validation Runs

## Baseline evidence imported

- WAV: `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`
- Key measured values from initial analysis:
  - Integrated loudness: about `-38.21 LUFS`
  - True peak: about `-20.87 dBFS`
  - Silence windows detected between about `14.61s` and `19.67s`
  - L-R residual around `-91 dB` (dual-mono symptom)
- Additional reference capture (Feb 21, 2026):
  - Source: `evidence/raw/ScreenRecording_02-21-2026_18-58-44_1.MP4`
  - Extracted WAV metrics:
    - `max_volume` around `-11.0 dBFS` (not hard-clipped)
    - L-R residual around `-91 dB` (dual-mono collapse symptom)
    - Frequent short near-silence windows (`-35 dB`, `>=80ms`)

## How to run capture metrics

Use:

```bash
bash scripts/tools/analyze_capture_metrics.sh "evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav"
```

## Acceptance targets for v8.0 transport-first

- Continuous source material should not produce silence windows longer than 250ms.
- Stereo test material should show meaningful L/R difference (not near silence floor).
- Outbound RTP should not stall during active publish.
- Opus guard should show expected parameters (`usedtx=0`, stereo/fullband, no `cbr`).

## Runtime gate command (Atlas console)

```js
await mgameGateCheck(500, 12000)
```

Pass criteria:

- `pass: true`
- `dropoutProbe.dropouts === 0`
- `stereoGateState === "pass"`
- `sdpGuard.pass === true`

If strict mode fails, use immediate fallback and re-run:

```js
mgameProfile('compat_v52')
await mgameGateCheck(500, 12000)
```
