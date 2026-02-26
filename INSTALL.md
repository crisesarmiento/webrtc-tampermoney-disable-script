# Install, Scope, and Rollback Guide (v8.0 Strict Blocker)

This guide documents the **standalone strict blocker userscript** in this repository:

- `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`

The script runs in Tampermonkey and applies strict WebRTC audio handling defaults with a compatibility fallback profile.

---

## 1) Install flow

### Prerequisites

- Chromium-based browser with Tampermonkey installed.
- Access to one of the supported domains (listed in [Domain scope](#2-domain-scope)).

### Option A: Import from file (recommended)

1. Open Tampermonkey dashboard.
2. Go to **Utilities** -> **Import from file**.
3. Choose:
   - `scripts/current/M-Game Clean Audio v7.0-baseline.user.js`
4. Save and verify the script is **Enabled**.

### Option B: Create manually

1. Tampermonkey -> **Create a new script**.
2. Replace editor content with the file above.
3. Save and verify the script is **Enabled**.

### Verify installation

1. Open a supported site tab and reload it.
2. Open DevTools Console.
3. Run:

```js
mgameStatus()
```

Expected:

- `version: "8.0-transport-first"`
- `profile: "strict"` (default)
- `supportedConstraints` populated where browser supports them

---

## 2) Domain scope

The script is intentionally scoped by metadata `@match` rules to these domains only:

- `https://x.com/*`
- `https://twitter.com/*`
- `https://chatgpt.com/*`

Practical implications:

- The script **does not run** on other websites unless `@match` values are changed.
- Atlas usage is covered under `chatgpt.com` URLs.
- X Spaces usage is covered under `x.com` and `twitter.com` URLs.

---

## 3) How to use in a live session

1. Open Atlas or X Spaces in a supported tab.
2. Start/join the live flow and begin publishing audio.
3. In Console, run checks in order:

```js
mgameInspect()
await mgameStereoProbe(1500)
await mgameDropoutProbe(500, 12000)
await mgameCodecProbe(1200, 12000)
await mgameGateCheck(500, 12000)
```

If strict mode fails, switch to compatibility profile and re-check:

```js
mgameProfile('compat_v52')
await mgameGateCheck(500, 12000)
```

---

## 4) Explicit limitations and known breakage

The strict blocker is intentionally opinionated. These constraints are known and expected:

1. **Browser/engine variability**
   - Constraint support differs by browser build/platform.
   - Some `getUserMedia` or sender parameter hints can be ignored by the runtime.

2. **Profile behavior differences**
   - `strict` is default and prioritizes transport/stereo checks.
   - `compat_v52` may be required on unstable renegotiation paths.

3. **Stereo gate sensitivity**
   - Stereo diagnostics can flag near-identical channels as dual-mono risk.
   - Some program material may look near-identical even when not fully broken.

4. **Site update risk**
   - Atlas/X Spaces frontend changes can alter timing, sender wiring, or negotiation behavior.
   - Previously passing checks may regress after site deploys.

5. **Out-of-scope behavior**
   - The script does not modify native desktop apps.
   - The script does not guarantee identical behavior across all hardware/audio driver routes.

---

## 5) Rollback and recovery

### Fast rollback (no tab reload first)

```js
mgameProfile('compat_v52')
```

Then re-run:

```js
await mgameGateCheck(500, 12000)
```

### Full rollback

1. Disable the userscript in Tampermonkey.
2. Reload the affected Atlas/X tab.
3. Re-test publishing.

### Legacy rollback target

If needed, temporarily use a known older script from:

- `scripts/legacy/`

---

## 6) Validation and evidence capture

For audio capture regression checks:

```bash
bash scripts/tools/analyze_capture_metrics.sh "/absolute/path/to/capture.wav"
```

Baseline reference capture:

- `evidence/audio/ScreenRecording_02-20-2026-12-18-00_1.wav`
