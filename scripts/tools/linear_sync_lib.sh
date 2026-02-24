#!/usr/bin/env bash

set -euo pipefail

linear_require_env() {
  local missing=0
  for key in LINEAR_API_KEY LINEAR_TEAM_ID LINEAR_PROJECT_ID; do
    if [ -z "${!key:-}" ]; then
      echo "Missing required secret: ${key}" >&2
      missing=1
    fi
  done

  if [ "$missing" -ne 0 ]; then
    return 1
  fi
}

linear_emit_summary() {
  local ce_id="$1"
  local status="$2"
  local reason="${3:-}"
  local line="linear_sync ce_id=${ce_id} status=${status}"
  if [ -n "$reason" ]; then
    line+=" reason=${reason}"
  fi
  echo "$line"
}
