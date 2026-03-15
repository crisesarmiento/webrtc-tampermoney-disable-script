# v9 Roadmap

## v9.0 (planned)

Minimum effective strict WebRTC blocker release:

- New standalone userscript:
  - `scripts/current/WebRTC Strict Blocker.user.js`
- Scope:
  - `https://chatgpt.com/*`
  - `https://x.com/*`
  - `https://twitter.com/*`
- Strict-only API neutralization:
  - `RTCPeerConnection` (+ prefixed aliases)
  - `RTCSessionDescription` (+ prefixed aliases)
  - legacy `navigator.getUserMedia` aliases
  - modern `navigator.mediaDevices.getUserMedia`

Release artifacts:

- Install guide:
  - `docs/setup/webrtc-strict-blocker-install.md`
- Validation matrix:
  - `docs/validation/webrtc-v9-strict-matrix.md`
- Research note:
  - `docs/analysis/v9-webrtc-disable-research.md`
