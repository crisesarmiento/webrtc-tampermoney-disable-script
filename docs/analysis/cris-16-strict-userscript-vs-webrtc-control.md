# CRIS-16 Research: Strict userscript blocker vs WebRTC Control extension

## Purpose

Provide an evidence-backed comparison between:

1. **Strict userscript blocker** (Tampermonkey-first, repository approach), and
2. **WebRTC Control extension** (browser-extension toggle model).

This note focuses on behavior, reliability, UX tradeoffs, compatibility boundaries, and rollout guidance for the v9.0 milestone.

## Evidence scope (what we use and why)

### Repository evidence (primary)

- Runtime design and fallback model from the current userscript implementation (`strict` + `compat_v52`).
- Operational install/diagnostic/rollback workflow.
- Validation and capture analysis baseline metrics.

### Do we need external web citations for this decision?

**Not required for the core CRIS-16 recommendation.**

Reason:

- The decision we need to make is operational and project-specific (Atlas/X Spaces behavior, runbook quality, rollback safety, and targeted-domain control).
- Those criteria are directly validated by repository code and runbook docs.
- External docs can add general background, but they do not replace project runtime evidence for release decisions.

## Option A: Strict userscript blocker (Tampermonkey-first)

### Observed behavior

- Hooks browser WebRTC entry points used by pages (`navigator.mediaDevices.getUserMedia`, `window.RTCPeerConnection`) and applies transport-focused policies at runtime.
- Defaults to a strict profile and exposes explicit fallback to `compat_v52` with live diagnostics.
- Emphasizes in-session observability (`mgameStatus`, `mgameInspect`, `mgameGateCheck`) and no-reload fallback path where possible.

### Reliability profile

**Strengths**

- Deterministic per-domain scope via userscript match rules.
- Built-in runtime introspection and recovery commands reduce "black-box" failure handling.
- Granular behavior can evolve with product-specific requirements (Atlas/X Spaces flow).

**Limitations**

- Depends on page-level API interception; cannot enforce behavior outside injected scope.
- Susceptible to upstream app/API changes that bypass expected code paths.
- Requires Tampermonkey install + script lifecycle management by the operator.

### UX tradeoffs

- **Pro:** Fine-grained control with explicit commands and profile switching.
- **Con:** Higher cognitive load for non-technical users vs one-click extension toggles.

## Option B: WebRTC Control extension (global browser toggle model)

### Expected behavior pattern

- Provides a browser-level on/off control intended to reduce or block WebRTC behavior broadly (depending on browser support and extension internals).
- Typically simpler to explain: enable/disable icon toggle rather than profile-level runtime controls.

### Reliability profile

**Strengths**

- Lower operational complexity for quick privacy posture changes.
- Useful as a coarse-grained fail-safe when app-specific tuning is not required.

**Limitations / compatibility boundaries**

- Usually global or broad-scope behavior; weak fit for domain-specific selective enforcement.
- Less visibility into app-specific sender stats, renegotiation behavior, and audio-chain state.
- Browser-version and extension-policy changes can reduce effectiveness or alter behavior without app-aware diagnostics.
- May break required WebRTC features entirely (high bluntness), which is acceptable for strict privacy scenarios but not for controlled media quality workflows.

### UX tradeoffs

- **Pro:** Low-friction for non-technical users; easy rollback via extension toggle.
- **Con:** Coarse control surface; limited product-specific diagnostics.

## Side-by-side comparison

| Dimension | Strict userscript blocker | WebRTC Control extension |
|---|---|---|
| Scope control | Fine-grained, domain-targeted | Usually broad/global |
| Observability | High (`mgame*` diagnostics + profile state) | Low-to-medium (depends on extension UI) |
| Reliability for Atlas/X Spaces tuning | Higher, app-aware | Lower, app-agnostic |
| Ease of adoption | Medium (install script + run checks) | High (install + toggle) |
| Risk of over-blocking | Lower when tuned per-domain | Higher due to coarse behavior |
| Change agility | High (script updates in repo workflow) | Medium (depends on extension vendor/release cadence) |

## Recommendation

### Primary recommendation

Use **strict userscript blocker as the default strategy** for v9.0 targeted-domain rollout.

### Decision criteria (explicit)

Choose **strict userscript blocker** when all are true:

- You need domain-level precision (not global browser disable).
- You need live diagnostics and evidence capture during publish sessions.
- You need reversible, profile-based fallback (`strict` -> `compat_v52`) without abandoning the entire approach.

Choose **WebRTC Control extension** when one or more are true:

- You need immediate coarse blocking across the browser.
- You cannot operate a script lifecycle (Tampermonkey unavailable/restricted).
- The use case prioritizes broad privacy hard-stop over media-quality optimization and app-specific observability.

## Risks, limitations, and rollback guidance

### Key risks

1. **Userscript strict mode false negatives/positives** during platform updates.
2. **Extension over-blocking** that prevents required publish flows.
3. **Operational drift** when users run inconsistent local configurations.

### Rollback guidance

For userscript path (recommended):

1. Immediate in-session fallback: `mgameProfile('compat_v52')`.
2. Re-run gate validation: `await mgameGateCheck(500, 12000)`.
3. If still failing, disable script in Tampermonkey and reload tab.
4. Revert to known-good legacy script from `scripts/legacy/` as contingency.

For extension path:

1. Toggle extension off to restore native WebRTC behavior.
2. Reload affected tabs and rejoin session.
3. If mixed policy is needed, remove global extension dependency and move to domain-targeted userscript model.

## Adoption guidance

- **v9.0 release path:** Keep strict userscript as primary, document extension as emergency coarse-control fallback.
- **Support model:** Standardize operator runbook around `mgameStatus`, `mgameInspect`, and gate checks before/after fallback changes.
- **Governance:** Keep recommendation tied to targeted-domain policy and evidence capture, not convenience alone.
