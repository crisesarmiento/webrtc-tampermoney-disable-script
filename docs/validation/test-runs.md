# Validation Runs

## Baseline evidence imported

- WAV: `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`
- Key measured values from initial analysis:
  - Integrated loudness: about `-38.21 LUFS`
  - True peak: about `-20.87 dBFS`
  - Silence windows detected between about `14.61s` and `19.67s`
  - L-R residual around `-91 dB` (dual-mono symptom)

## How to run capture metrics

Use:

```bash
bash scripts/tools/analyze_capture_metrics.sh "evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav"
```

## Acceptance targets for v7.0 baseline

- Continuous source material should not produce silence windows longer than 250ms.
- Stereo test material should show meaningful L/R difference (not near silence floor).
- Outbound RTP should not stall during active publish.
- No repeated forced sender reconfiguration loops.
