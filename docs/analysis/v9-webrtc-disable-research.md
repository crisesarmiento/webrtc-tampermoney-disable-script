# v9 Research: Minimum Effective WebRTC Disable

Research date:

- February 23, 2026

## Sources reviewed

- `https://greasyfork.org/en/scripts/397877-disable-webrtc`
- `https://greasyfork.org/en/scripts/397877-disable-webrtc/code`
- `https://chromewebstore.google.com/detail/webrtc-control/fjkmabmdepjfammlpliljpnbhleegehm`
- `https://developer.chrome.com/docs/extensions/reference/api/privacy`
- `https://stackoverflow.com/questions/61244780/how-to-remotely-enable-disable-a-tampermonkey-script-for-other-users`
- `https://raw.githubusercontent.com/egi24/webrtc-control/master/README.md`
- `https://www.tampermonkey.net/documentation.php`

## Conclusions

1. The GreasyFork script is useful as a baseline but not complete for modern browser behavior.
2. The baseline snippet misses robust handling expectations for `navigator.mediaDevices.getUserMedia` and defensive override hardening.
3. A strict userscript can reliably block page-level WebRTC API access on matched domains, but this may break real-time features.
4. WebRTC Control extension behavior is mainly policy/leak-mitigation oriented and does not represent guaranteed full API-disable semantics for all cases.
5. Remote enable/disable patterns from Stack Overflow (for example fetching a remote flag) are optional operational controls, not authoritative enforcement over user-local Tampermonkey settings.

## Why v9 uses strict selected-domain blocking

- Goal is deterministic blocking on the target properties where user impact is acceptable.
- Selected-domain scope avoids global collateral breakage from `*://*/*`.
- `document-start` is required to reduce early script race windows.

## Out-of-scope for v9

- System-wide network policy management
- Extension packaging or browser enterprise policy rollout
- Remote-control backend for toggling user scripts
