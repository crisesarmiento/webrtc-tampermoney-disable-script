# v9 Strict Blocker Validation

## Environment

- Browser: Chromium-family browser with Tampermonkey.
- Script under test: `scripts/current/Disable WebRTC Audio Processing v9.0-strict.user.js`.

## Manual Validation Checklist

1. Load a site that requests microphone access.
2. Confirm console log includes `[WebRTC Blocker v9.0] Installed strict blocker globally.`
3. Trigger microphone capture and verify `getUserMedia intercepted` log appears.
4. Trigger any in-app mic setting changes and verify `applyConstraints intercepted for audio track` appears.
5. Run `webrtcBlockerV9Status()` and confirm all audio processing flags are `false` (or `voiceIsolation: "unsupported"`).

## Expected Outcome

- Browser-level AGC/NS/EC flags remain disabled across both initial capture and later constraint updates.
- Script functions independently from Atlas/X transport tuning logic.
