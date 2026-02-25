# CE-296 Validation Matrix: Strict Blocking Behavior

This document defines a reproducible test matrix for the strict WebRTC-blocking userscript behavior on target domains, plus one non-target control.

## Scope

- Target domains under strict blocking policy:
  - `https://chatgpt.com/atlas/*`
  - `https://x.com/*`
  - `https://twitter.com/*`
- Non-target control:
  - `https://meet.jit.si/*` (control site outside script scope)

## Test Environment

- Browser: Google Chrome (stable)
- Extension runtime: Tampermonkey enabled
- Script profile: strict blocking enabled
- Clean run setup:
  1. Open a fresh incognito window with Tampermonkey allowed.
  2. Confirm only the strict-block userscript is enabled.
  3. Open DevTools Console before each run and clear logs.

## Reproducible Procedure (run for each row)

1. Navigate to the test URL.
2. Hard refresh the page.
3. Trigger any flow that attempts microphone/camera/WebRTC publish.
4. Capture evidence:
   - Console output and errors
   - Permission prompt behavior
   - Network/WebRTC internals behavior
5. Record result in the matrix.

## Validation Matrix

| ID | Domain type | URL | Expected strict behavior | Observed result | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | Target | `https://chatgpt.com/atlas/` | WebRTC creation paths are blocked before publish; no usable outbound media path is established. | `RTCPeerConnection`/capture-dependent publish path is blocked on load; Atlas cannot complete live publish init. | Pass | Blocking is active at target scope. |
| T2 | Target | `https://x.com/i/spaces` | Spaces live audio publish path is blocked under strict mode; media session cannot start normally. | Attempting to start/publish in Spaces fails to initialize live audio transport due to strict block hooks. | Pass | Matches strict behavior goal for X target. |
| T3 | Target | `https://twitter.com/i/spaces` | Legacy Twitter host should receive same strict block behavior as `x.com`. | Same block behavior observed as `x.com`; publish path does not initialize. | Pass | Host alias parity validated. |
| C1 | Non-target control | `https://meet.jit.si/` | Script should not apply strict block outside target list; native WebRTC behavior remains available. | Control site can proceed through normal device/WebRTC flow (subject to local permissions). | Pass | Confirms scope-limited blocking and avoids global breakage. |

## Regression Notes

### Regressions checked

- Overblocking on non-target domains.
- Host mismatch (`x.com` vs `twitter.com`) behavior drift.
- Script execution errors at page load.

### Findings

- No non-target overblocking observed in control run (`C1`).
- No host parity drift observed between `T2` and `T3`.
- No additional runtime exceptions identified beyond expected strict-block denials.

## Conclusion

- Validation matrix completed for all scoped targets plus one non-target control.
- Regression notes collected and recorded.
- Current strict-block behavior is consistent with CE-296 acceptance criteria.
