#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <audio-file.wav>" >&2
  exit 1
fi

AUDIO_FILE="$1"
if [[ ! -f "$AUDIO_FILE" ]]; then
  echo "File not found: $AUDIO_FILE" >&2
  exit 1
fi

echo "== Input file =="
ffprobe -hide_banner -show_streams -show_format "$AUDIO_FILE" 2>&1 | sed -n '1,120p'

echo
echo "== Loudness (EBU R128 via loudnorm report) =="
ffmpeg -hide_banner -i "$AUDIO_FILE" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '1,220p'

echo
echo "== Volume detect =="
ffmpeg -hide_banner -i "$AUDIO_FILE" -af volumedetect -f null - 2>&1 | rg "mean_volume|max_volume|histogram" || true

echo
echo "== Silence windows (-50dB for >=250ms) =="
ffmpeg -hide_banner -i "$AUDIO_FILE" -af silencedetect=noise=-50dB:d=0.25 -f null - 2>&1 | rg "silence_start|silence_end" || true

echo
echo "== Channel identity check (L-R residual) =="
ffmpeg -hide_banner -i "$AUDIO_FILE" -af 'pan=mono|c0=c0-c1,volumedetect' -f null - 2>&1 | rg "mean_volume|max_volume" || true

echo
echo "== Band energy quick check =="
for spec in "full:anull" "0-4k:lowpass=f=4000" "4-8k:highpass=f=4000,lowpass=f=8000" "8-12k:highpass=f=8000,lowpass=f=12000" "12k+:highpass=f=12000"; do
  name="${spec%%:*}"
  af="${spec#*:}"
  echo "-- $name --"
  ffmpeg -hide_banner -i "$AUDIO_FILE" -af "$af,volumedetect" -f null - 2>&1 | rg "mean_volume|max_volume" || true
done
