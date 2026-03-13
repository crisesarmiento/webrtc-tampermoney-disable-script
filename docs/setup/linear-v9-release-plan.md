# Linear Configuration: Post-v8.2 Release Prep (CRIS-18)

This document tracks the next production release after tag `v8.2`.

## Release Tracker

- Issue key: `CRIS-18`
- Title: `Release prep: next version after v8.2 (v10/v11 media hardening + CRIS workflow governance)`
- Scope:
  - Confirm release-ready state of the `development` baseline
  - Verify whether `CRIS-123` is included in this release cut
  - Prepare `development -> main` release PR content
  - Track post-merge tag + draft-release automation

## Included Work (Current Baseline)

### Workflow and governance hardening

- `CRIS-120` — branch/PR governance migration to CRIS-first
- `CRIS-121` — branch remediation hardening and contract checks

### WebRTC script evolution

- `CRIS-122` — v10 minimal music-first constraints hardener for X/Atlas
- `CRIS-123` — v11 DEBUG diagnostics for `getUserMedia` / `applyConstraints` hardening

## Release Readiness Checklist

- [x] CRIS workflow hardening completed (`CRIS-120`, `CRIS-121`)
- [x] v10 minimal hardener completed (`CRIS-122`)
- [ ] Confirm `CRIS-123` merged into `development` (or explicitly defer)
- [ ] Open/merge release PR `development -> main`
- [ ] Validate tag + draft GitHub Release automation
- [ ] Finalize release notes (media hardening + debug behavior + workflow updates)

## Decision Gate

- If `CRIS-123` is merged in time, include v11 diagnostics in this release.
- If `CRIS-123` is not merged in time, release from current `development` baseline and defer v11.

## Workflow Contract

- Branch format (normal work): `codex/CRIS-<number>-<slug>`
- PR title format (normal work): `[CRIS-<number>] <short title>`
- Release flow exemption: `development -> main`
- Required checks: `validate`, `require-linked-issue`, `codex-review`

## Release PR Body Template

```md
## Release Summary
Promote `development` to `main` for the next release after `v8.2`.

Closes CRIS-18.

## Included Work
- [x] CRIS-120: CRIS-first branch/PR governance migration
- [x] CRIS-121: branch remediation hardening
- [x] CRIS-122: v10 minimal music-first WebRTC constraints hardener
- [ ] CRIS-123: v11 DEBUG diagnostics (check only if merged in `development` before release merge)

## Pre-Merge Checklist
- [ ] `validate` green
- [ ] `require-linked-issue` green
- [ ] `codex-review` green
- [ ] Final release notes reviewed
- [ ] Decision recorded: include/exclude CRIS-123 in this cut

## Post-Merge Verification
- [ ] Tag auto-created from release workflow
- [ ] Draft GitHub Release auto-created
- [ ] Linear release tracking updated
```

## Release Gate Comment Template

```md
Release gate check for `development -> main`:

- CI required checks: ✅/❌
- CRIS-123 included in this release: ✅/❌
- Tag + draft release automation expected: ✅
- Decision: merge now / hold for CRIS-123

If merged now, this closes CRIS-18 and starts post-merge release verification.
```
