# Atlas + M-Game + macOS Configuration Snapshot

## Hardware

- OS: macOS (MacBook Pro M3 Pro)
- Interface: RODE M-Game RGB Dual (USB stereo path)
- Mic: Audio-Technica AT2020 (connected to M-Game)

## Browser roles

- Primary host/join browser: Atlas (`https://chatgpt.com/atlas/`)
- Secondary playback browser: Google Chrome (music/listening only)

## Atlas publish device

- Runtime input label: `Default - M-Game RGB Dual Stream`

## Routing notes (from captured screenshots)

- Output redirection:
  - Chrome -> `SAMPLER OUT`
  - Music app -> `GAME OUT`
  - System -> `SYSTEM OUT`
- Default Core Audio output for non-redirected apps: `GAME OUT`

## Intended signal path

Music source -> macOS output routing -> M-Game game/stream mix -> Atlas `getUserMedia` capture -> userscript intercept -> WebRTC Opus -> X Spaces listeners

## Validation focus for v7.0 baseline

- Continuous audio (no unexpected silent windows)
- Stereo preservation (no dual-mono collapse)
- Stable outbound sender bitrate/hints without timer spam
- No additional DSP stages in baseline release
