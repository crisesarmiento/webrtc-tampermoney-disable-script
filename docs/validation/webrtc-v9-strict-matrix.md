# v9 Strict Blocker Validation Matrix

Release target window:

- February 24, 2026 to March 10, 2026

Script under test:

- `scripts/current/WebRTC Strict Blocker.user.js`

## Test matrix

| ID | Scenario | Domain | Steps | Expected | Status |
|---|---|---|---|---|---|
| V9-01 | Constructor block | `chatgpt.com` | Load page, run `typeof RTCPeerConnection`, attempt constructor usage | WebRTC constructor is not usable | Pending |
| V9-02 | Modern API block | `chatgpt.com` | Run `navigator.mediaDevices.getUserMedia({ audio: true })` | Promise rejects with blocker reason | Pending |
| V9-03 | Legacy API block | `chatgpt.com` | Run `navigator.getUserMedia` path if present | Legacy entry points are blocked | Pending |
| V9-04 | Constructor block | `x.com` | Repeat V9-01 on `x.com` | Same strict blocking behavior | Pending |
| V9-05 | Modern API block | `x.com` | Repeat V9-02 on `x.com` | Same strict blocking behavior | Pending |
| V9-06 | Constructor block | `twitter.com` | Repeat V9-01 on `twitter.com` | Same strict blocking behavior | Pending |
| V9-07 | Modern API block | `twitter.com` | Repeat V9-02 on `twitter.com` | Same strict blocking behavior | Pending |
| V9-08 | Non-target control | Any non-matched domain | Run WebRTC checks outside match scope | Script has no effect | Pending |
| V9-09 | Race timing | Matched domains | Hard reload and run checks immediately | Blocking is active from `document-start` | Pending |
| V9-10 | Compatibility check | `chatgpt.com` / `x.com` | Validate existing M-Game script path remains untouched | No regression in `scripts/current/M-Game Clean Audio.user.js` path | Pending |

## Run notes template

Use this format per run:

```text
Date:
Browser:
Tampermonkey version:
Domain:
Scenario IDs:
Observed result:
Pass/Fail:
Notes:
```
