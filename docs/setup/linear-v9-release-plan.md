# Linear Configuration: v9 Strict WebRTC Blocker Release

Team:

- `CE`

Labels:

- `webrtc`
- `tampermonkey`
- `release-v9`
- `privacy`

Target window:

- Start: February 24, 2026
- End: March 10, 2026

## Milestone / release bucket

- Issue key: `CE-NEW-1` (placeholder)
- Title: `[CE-NEW-1] v9.0 milestone: minimum WebRTC disable (selected domains)`
- Scope:
  - Release tracking
  - Child issue linkage
  - Go/no-go checklist
  - Release notes draft

## Work tickets

### CE-NEW-2

- Title: `[CE-NEW-2] Implement strict WebRTC blocker userscript for Atlas + X`
- Linear issue: `<to be created>`
- Priority: `High`
- Scope:
  - Add standalone userscript artifact
  - Strict-only behavior
  - Selected domain matches (`chatgpt.com`, `x.com`, `twitter.com`)
- Acceptance:
  - On target domains, blocked APIs are not usable
  - Script loads at `document-start`
  - No changes to `scripts/current/M-Game Clean Audio.user.js`

### CE-NEW-3

- Title: `[CE-NEW-3] Add validation matrix for strict blocking behavior`
- Linear issue: `<to be created>`
- Priority: `High`
- Scope:
  - Create reproducible validation matrix
  - Include one non-target domain control test
- Acceptance:
  - Matrix completed
  - Regressions documented

### CE-NEW-4

- Title: `[CE-NEW-4] Documentation for install, scope, and known breakage`
- Linear issue: `<to be created>`
- Priority: `Medium`
- Scope:
  - Install flow
  - Limitations and rollback
  - Known breakage warning
- Acceptance:
  - Clear docs published for install/use/rollback

### CE-NEW-5

- Title: `[CE-NEW-5] Research note: userscript strict block vs WebRTC Control extension`
- Linear issue: `<to be created>`
- Priority: `Medium`
- Scope:
  - Evidence-backed comparison
  - Recommendation boundaries
- Acceptance:
  - Final note published in `docs/analysis/`

## Workflow notes

- Branch format: `codex/CE-<number>-<slug>`
- PR title format: `[CE-<number>] <short title>`
- Optional magic words must use the same `CE-<number>`
- Normal work targets `development`

## Status

Use private Linear workspace references (not committed in repository files) to map these placeholders to real issue IDs and URLs.
