#!/usr/bin/env bash
set -euo pipefail

validate_case() {
  local head_ref="$1" title="$2" body="$3" base_ref="$4" expected="$5"
  local ok=0

  if [ "$base_ref" = "master" ] && [ "$head_ref" = "development" ]; then
    ok=1
  elif [[ "$head_ref" =~ ^codex/(CE-[0-9]+)-[a-z0-9][a-z0-9._-]*$ ]] && [[ "$title" =~ ^\[(CE-[0-9]+)\][[:space:]]+.+$ ]]; then
    local b="${BASH_REMATCH[1]}"
    [[ "$head_ref" =~ ^codex/(CE-[0-9]+)- ]] && local h="${BASH_REMATCH[1]}"
    if [ "$h" = "$b" ]; then
      local magic
      magic="$(printf '%s\n' "$body" | grep -Eio '(close[sd]?|fix(e[sd])?|resolve[sd]?)[:[:space:]]+CE-[0-9]+' | grep -Eio 'CE-[0-9]+' | sort -u || true)"
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
validate_case 'codex/CE-300-hardening' '[CE-301] Harden automation' '' 'development' fail
validate_case 'development' 'Release v8.0' '' 'master' pass
validate_case 'feature/misc' 'No CE title' '' 'development' fail

echo 'require-linked-issue contract smoke tests passed'
