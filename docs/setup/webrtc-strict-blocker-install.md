# Install and Validate: v9 WebRTC Strict Blocker

This guide is for the standalone userscript:

- `scripts/current/WebRTC Strict Blocker.user.js`

Scope in v9:

- `https://chatgpt.com/*`
- `https://x.com/*`
- `https://twitter.com/*`

Behavior in v9:

- Strict-only (no runtime toggle)
- Blocks WebRTC constructors and `getUserMedia` entry points

## 1) Install in Tampermonkey

1. Open Tampermonkey dashboard.
2. Click `Utilities` -> `Import from file`.
3. Select:
   - `scripts/current/WebRTC Strict Blocker.user.js`
4. Save and verify the script is enabled.

## 2) Confirm the script is loaded

Open DevTools on a matched domain and run:

```js
webrtcBlockerStatus()
```

Expected:

- `installed: true`
- `version: "9.0"`
- `blockedTargets` includes constructor and `getUserMedia` entries

## 3) Quick behavior checks on matched domains

Run:

```js
typeof RTCPeerConnection
```

Then:

```js
navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => e.message)
```

Expected:

- Constructor use is blocked (not usable for WebRTC session setup)
- `getUserMedia` rejects with the blocker reason

## 4) Non-target control test

Open a non-matched domain and run:

```js
typeof RTCPeerConnection
```

Expected:

- This script should not affect non-matched domains.

## 5) Rollback

If a target site requires WebRTC and breaks:

1. Disable `WebRTC Strict Blocker (Atlas + X)` in Tampermonkey.
2. Reload the site tab.
3. Re-run checks to confirm WebRTC APIs are restored.

## Known limitations

- Sites that depend on real-time calling, screen share, or conferencing may fail while the script is enabled.
- This userscript blocks in-page API access; it is not a system-wide browser network policy control.
