#!/usr/bin/env bash
set -euo pipefail

normalize_branch() {
  local source_branch="$1"
  local allowed_keys_csv="${2:-CRIS,CE}"

  node - "$source_branch" "$allowed_keys_csv" <<'NODE'
const sourceBranch = process.argv[2];
const allowedKeysRaw = process.argv[3] || 'CRIS,CE';

const canonicalPattern = /^codex\/([A-Z]+-\d+)-([a-z0-9][a-z0-9._-]*)$/;
const legacyPattern = /^(?:(?:codex|feature)\/)?([a-z]+-\d+)-(.+)$/i;
const looseLinearPattern = /(?:^|[-_/])([a-z]+-\d+)(?:[-_/]|$)/i;

const allowedKeys = new Set(
  allowedKeysRaw
    .toUpperCase()
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean),
);

if (allowedKeys.size === 0) {
  allowedKeys.add('CRIS');
  allowedKeys.add('CE');
}

function sanitizeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function deriveFromNonCanonicalCodex(branchName) {
  if (!branchName.startsWith('codex/')) {
    return null;
  }

  const tail = branchName.slice('codex/'.length);
  const idMatch = tail.match(looseLinearPattern);
  if (!idMatch) {
    return null;
  }

  const idRaw = idMatch[1];
  const linearId = idRaw.toUpperCase();
  const lowerTail = tail.toLowerCase();
  const matchIndex = lowerTail.indexOf(idRaw.toLowerCase());
  const suffix = tail.slice(matchIndex + idRaw.length).replace(/^[-_/]+/, '');
  const prefix = tail.slice(0, matchIndex).replace(/[-_/]+$/, '');
  const slug = sanitizeSlug(suffix || prefix || `${linearId.toLowerCase()}-work`);

  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
    return null;
  }

  return { linearId, slug };
}

let branch = sourceBranch;
let linearId = '';
let slug = '';
let normalizedFrom = '';

const canonicalMatch = sourceBranch.match(canonicalPattern);
if (canonicalMatch) {
  linearId = canonicalMatch[1];
  slug = canonicalMatch[2];
} else {
  const legacyMatch = sourceBranch.match(legacyPattern);
  const looseCodexMatch = deriveFromNonCanonicalCodex(sourceBranch);

  if (legacyMatch) {
    linearId = legacyMatch[1].toUpperCase();
    slug = sanitizeSlug(legacyMatch[2]);
  } else if (looseCodexMatch) {
    linearId = looseCodexMatch.linearId;
    slug = looseCodexMatch.slug;
  } else {
    console.log('SKIP_NON_CONFORMING');
    process.exit(0);
  }

  if (!slug || !/^[a-z0-9][a-z0-9._-]*$/.test(slug)) {
    console.log('SKIP_BAD_SLUG');
    process.exit(0);
  }

  const legacyLinearKey = linearId.split('-')[0];
  if (!allowedKeys.has(legacyLinearKey)) {
    console.log(`SKIP_DISALLOWED_KEY:${legacyLinearKey}`);
    process.exit(0);
  }

  branch = `codex/${linearId}-${slug}`;
  normalizedFrom = sourceBranch;
}

const linearKey = linearId.split('-')[0];
if (!allowedKeys.has(linearKey)) {
  console.log(`SKIP_DISALLOWED_KEY:${linearKey}`);
  process.exit(0);
}

console.log(JSON.stringify({ branch, linearId, slug, normalizedFrom }));
NODE
}

assert_normalized() {
  local source_branch="$1"
  local expected_branch="$2"
  local expected_linear_id="$3"
  local expected_slug="$4"
  local expected_from="$5"
  local allowed_keys="${6:-CRIS,CE}"

  local out
  out="$(normalize_branch "$source_branch" "$allowed_keys")"
  local expected
  expected="{\"branch\":\"$expected_branch\",\"linearId\":\"$expected_linear_id\",\"slug\":\"$expected_slug\",\"normalizedFrom\":\"$expected_from\"}"

  if [ "$out" != "$expected" ]; then
    echo "Normalization assertion failed for: $source_branch"
    echo "Expected: $expected"
    echo "Actual:   $out"
    exit 1
  fi
}

assert_skip() {
  local source_branch="$1"
  local expected_prefix="$2"
  local allowed_keys="${3:-CRIS,CE}"

  local out
  out="$(normalize_branch "$source_branch" "$allowed_keys")"
  if [[ "$out" != "$expected_prefix"* ]]; then
    echo "Skip assertion failed for: $source_branch"
    echo "Expected prefix: $expected_prefix"
    echo "Actual:          $out"
    exit 1
  fi
}

# Canonical branch is preserved.
assert_normalized \
  'codex/CRIS-121-fix-branch-policy' \
  'codex/CRIS-121-fix-branch-policy' \
  'CRIS-121' \
  'fix-branch-policy' \
  ''

# Legacy branch is normalized to canonical codex/ form.
assert_normalized \
  'cris-121-Finalize Branch remediation!!!' \
  'codex/CRIS-121-finalize-branch-remediation' \
  'CRIS-121' \
  'finalize-branch-remediation' \
  'cris-121-Finalize Branch remediation!!!'

# Non-canonical codex/ branch with leading issue token is normalized.
assert_normalized \
  'codex/cris-405-Title.With MIXED Case' \
  'codex/CRIS-405-title.with-mixed-case' \
  'CRIS-405' \
  'title.with-mixed-case' \
  'codex/cris-405-Title.With MIXED Case'

# Non-canonical codex/ branch with embedded issue token is normalized.
assert_normalized \
  'codex/linear-mention-cris-16-research-strict-userscript-blocker' \
  'codex/CRIS-16-research-strict-userscript-blocker' \
  'CRIS-16' \
  'research-strict-userscript-blocker' \
  'codex/linear-mention-cris-16-research-strict-userscript-blocker'

# feature/ legacy prefix is normalized.
assert_normalized \
  'feature/ce-404-Fix.Mixed_slug value' \
  'codex/CE-404-fix.mixed_slug-value' \
  'CE-404' \
  'fix.mixed_slug-value' \
  'feature/ce-404-Fix.Mixed_slug value'

# Unknown branch shape is ignored.
assert_skip 'hotfix/no-linear-id' 'SKIP_NON_CONFORMING'

# Disallowed keys are ignored.
assert_skip 'feature/abc-77-test-slug' 'SKIP_DISALLOWED_KEY:ABC'
assert_skip 'codex/CE-500-allowed-only-under-transition' 'SKIP_DISALLOWED_KEY:CE' 'CRIS'

echo 'auto-create-pr branch policy contract smoke tests passed'
