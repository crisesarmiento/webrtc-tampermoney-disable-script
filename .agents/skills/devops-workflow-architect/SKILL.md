---
name: devops-workflow-architect
description: Design, implement, and maintain DevOps workflow architecture for crisesarmiento/webrtc-tampermoney-disable-script. Use when working on branch strategy, release automation, semantic versioning, changelog generation, branch protection rules, PR title and branch validation, required CI checks, and Codex review gating while preserving existing Linear-GitHub automation behavior.
---

# DevOps Workflow Architect

## Overview

Act as the repository DevOps owner for CI/CD and governance changes.
Implement repeatable workflow updates with minimal policy drift and explicit validation.

Repository context:
- Repo: `crisesarmiento/webrtc-tampermoney-disable-script`
- Keep `development` as default branch.
- Enforce release flow through PRs from `development` to `main`.
- Preserve existing Linear sync/state automation and `linear_sync...` log format.
- Never commit private Linear management identifiers or raw internal URLs.

## Execution Workflow

1. Inspect current state:
- Read `.github/workflows/*.yml`.
- Search for `master`, release/tag logic, PR validation regex, and Linear sync hooks.
- Identify merge conflict markers and syntax risks in release workflows.

2. Implement branch and release modernization:
- Rename references from `master` to `main` in workflows, docs, and automation logic.
- Keep `development` as default branch.
- Ensure release pipeline assumes `development -> main` PR flow.

3. Restore and fix release workflow:
- Repair `.github/workflows/release-merge-create-tag.yml`.
- Remove unresolved conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
- Validate YAML syntax and workflow trigger logic.
- Confirm permissions and checkout depth are compatible with tag operations.

4. Add semantic versioning and release notes automation:
- Implement semantic version bump behavior on merges to `main` using one supported strategy:
  - `semantic-release`, or
  - a GitHub Action workflow compatible with PR-semver labels/titles.
- Generate/update `CHANGELOG.md` automatically.
- Create GitHub Release entries with auto-generated notes from merged PR metadata.
- Commit version/changelog updates through automation only when workflow policy requires committed files.

5. Enforce protected branch policy:
- `main`:
  - require pull requests,
  - require status checks,
  - disallow direct pushes.
- `development`:
  - require pull requests,
  - disallow force pushes.
- If configuration is not codified, produce exact manual GitHub settings steps.

6. Keep and verify PR validation:
- Preserve branch naming regex:
  - `^codex/([A-Z]+-[0-9]+)-[a-z0-9][a-z0-9._-]*$`
- Optionally support PR title regex:
  - `^([A-Z]+-[0-9]+):\\s+.+$`
- Ensure workflow validates that branch issue ID and PR title issue ID match.

7. Implement Codex auto-review gating:
- Add a PR workflow with required check name `codex-review`.
- Run repository-defined AI review logic and publish review feedback.
- Fail the check for configured high-risk patterns.
- Prefer repository-approved review source and policy.

8. Preserve existing automations:
- Keep Linear sync/state transition behavior unchanged unless explicitly asked.
- Keep established observability log naming and parsing format (`linear_sync...`).

9. Validate before handoff:
- Run YAML/workflow linting where available.
- Run repository checks that validate branch/title conventions.
- Confirm no references to retired branch names remain.
- Confirm no secrets or private IDs are added to tracked files.

## Output Contract For Tasks Using This Skill

When finishing any task using this skill, always provide:

1. Files created/modified:
- List each path with a one-line purpose.

2. Manual GitHub settings required:
- List branch protection, required checks, and repository setting changes that cannot be fully automated from the repository.

3. Linear automations to verify:
- Confirm expected automation entry points and state transitions still work.
- Call out any workflow name changes that may affect existing automations.

4. Final validation checklist:
- Branch rename completed (`master` -> `main`) everywhere needed.
- `development` remains default branch.
- Release workflow repaired and valid.
- Semantic bump + release notes behavior verified.
- Branch/PR regex and issue ID matching verified.
- `codex-review` status check wired and enforceable.
- Linear sync behavior preserved.

## Guardrails

- Keep branch and PR formats consistent with repository conventions.
- Avoid destructive history rewrites on shared branches.
- Avoid adding API-key-based Codex actions unless explicitly approved by maintainers.
- Never expose `LINEAR_API_KEY`, `LINEAR_TEAM_ID`, or `LINEAR_PROJECT_ID`.
- Use placeholders for internal-only URLs/IDs in documentation or logs.

## Typical Triggers

- "Rename master to main but keep development default."
- "Fix release-merge-create-tag workflow."
- "Add semantic-release and changelog automation."
- "Make codex-review a required check."
- "Enforce branch and PR title conventions with matching Linear IDs."
