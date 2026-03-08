#!/usr/bin/env bash
set -euo pipefail

validate_case() {
  local head_ref="$1" title="$2" body="$3" base_ref="$4" expected="$5"
  local ok=0

  if [ "$base_ref" = "main" ] && [ "$head_ref" = "development" ]; then
    ok=1
  elif [[ "$head_ref" =~ ^codex/([A-Z]+-[0-9]+)-[a-z0-9][a-z0-9._-]*$ ]]; then
    local b="" h="" title_id=""
    [[ "$head_ref" =~ ^codex/([A-Z]+-[0-9]+)- ]] && local h="${BASH_REMATCH[1]}"
    if [[ "$title" =~ ^\[([A-Z]+-[0-9]+)\][[:space:]]+.+$ ]]; then
      title_id="${BASH_REMATCH[1]}"
    elif [[ "$title" =~ ^([A-Z]+-[0-9]+):[[:space:]]+.+$ ]]; then
      title_id="${BASH_REMATCH[1]}"
    fi
    if [ -n "$title_id" ] && [ "$h" = "$title_id" ]; then
      local magic
      magic="$(printf '%s\n' "$body" | tr '[:lower:]' '[:upper:]' | grep -Eo '(CLOSE[SD]?|FIX(E[SD])?|RESOLVE[SD]?)[:[:space:]]+[A-Z]+-[0-9]+' | grep -Eo '[A-Z]+-[0-9]+' | sort -u || true)"
      if [ -z "$magic" ] || [ "$magic" = "$h" ]; then
        ok=1
      fi
    fi
  fi

  if [ "$expected" = "pass" ] && [ "$ok" -ne 1 ]; then
    echo "Expected pass but failed: $head_ref | $title"
    return 1
  fi
  if [ "$expected" = "fail" ] && [ "$ok" -eq 1 ]; then
    echo "Expected fail but passed: $head_ref | $title"
    return 1
  fi
}

validate_case 'codex/CE-300-hardening' '[CE-300] Harden automation' 'Fixes CE-300' 'development' pass
validate_case 'codex/CRIS-300-hardening' '[CRIS-300] Harden automation' 'Fixes CRIS-300' 'development' pass
validate_case 'codex/CRIS-302-main-release' 'CRIS-302: Mainline release hardening' 'Fixes CRIS-302' 'development' pass
validate_case 'codex/CE-300-hardening' '[CE-301] Harden automation' '' 'development' fail
validate_case 'development' 'Release v8.0' '' 'main' pass
validate_case 'feature/misc' 'No Linear title' '' 'development' fail

echo 'require-linked-issue contract smoke tests passed'
