#!/usr/bin/env bash

set -euo pipefail

if [ -z "${LINEAR_API_KEY:-}" ]; then
  echo "Missing required secret: LINEAR_API_KEY"
  exit 1
fi

if [ -z "${LINEAR_PROJECT_ID:-}" ]; then
  echo "Missing required secret: LINEAR_PROJECT_ID"
  exit 1
fi

PR_TITLE="${PR_TITLE:-}"
PR_BODY="${PR_BODY:-}"

if [ -z "$PR_TITLE" ]; then
  echo "PR_TITLE is required."
  exit 1
fi

if [ -z "$PR_BODY" ]; then
  echo "PR_BODY is required."
  exit 1
fi

if [[ ! "$PR_TITLE" =~ \[([A-Z]+-[0-9]+)\] ]]; then
  echo "Release PR title must contain a Linear ticket ID in [KEY-123] format."
  exit 1
fi
RELEASE_TICKET="${BASH_REMATCH[1]}"
echo "Release tracker ticket: ${RELEASE_TICKET}"

mapfile -t INCLUDED_IDS < <(
  printf '%s\n' "$PR_BODY" \
    | grep -E '^[[:space:]]*-[[:space:]]*\[[xX]\].*[A-Z]+-[0-9]+' \
    | grep -Eo 'CRIS-[0-9]+' \
    | sort -u
)

if [ "${#INCLUDED_IDS[@]}" -eq 0 ]; then
  echo "No checked Included Work tickets found in PR body."
  echo "Expected checked lines like: - [x] CRIS-123: ..."
  exit 1
fi

echo "Included tickets: ${INCLUDED_IDS[*]}"

query_issue() {
  local identifier="$1"
  local payload response

  payload="$(jq -n \
    --arg identifier "$identifier" \
    '{
      query: "query($identifier:String!){ issue(id:$identifier){ id identifier url state { name type } priority estimate dueDate assignee { id name } project { id name } labels { nodes { id name } } } }",
      variables: { identifier: $identifier }
    }'
  )"

  response="$(curl -sS -X POST "https://api.linear.app/graphql" \
    -H "Content-Type: application/json" \
    -H "Authorization: ${LINEAR_API_KEY}" \
    --data-binary "$payload")"

  if [ "$(printf '%s' "$response" | jq 'has("errors")')" = "true" ]; then
    echo "Linear GraphQL query failed for ${identifier}:"
    echo "$response"
    return 1
  fi

  printf '%s' "$response"
}

failures=0

for ticket_id in "${INCLUDED_IDS[@]}"; do
  echo "Checking ${ticket_id}..."
  resp="$(query_issue "$ticket_id")" || {
    failures=$((failures + 1))
    continue
  }

  issue_id="$(printf '%s' "$resp" | jq -r '.data.issue.id // empty')"
  issue_url="$(printf '%s' "$resp" | jq -r '.data.issue.url // empty')"
  state_type="$(printf '%s' "$resp" | jq -r '.data.issue.state.type // empty')"
  state_name="$(printf '%s' "$resp" | jq -r '.data.issue.state.name // empty')"
  priority="$(printf '%s' "$resp" | jq -r '.data.issue.priority // empty')"
  estimate="$(printf '%s' "$resp" | jq -r '.data.issue.estimate // empty')"
  assignee_id="$(printf '%s' "$resp" | jq -r '.data.issue.assignee.id // empty')"
  due_date="$(printf '%s' "$resp" | jq -r '.data.issue.dueDate // empty')"
  project_id="$(printf '%s' "$resp" | jq -r '.data.issue.project.id // empty')"
  labels_count="$(printf '%s' "$resp" | jq -r '.data.issue.labels.nodes | length')"

  if [ -z "$issue_id" ]; then
    echo "- ${ticket_id}: not found in Linear."
    failures=$((failures + 1))
    continue
  fi

  issue_failed=0

  if [ "$state_type" != "completed" ]; then
    echo "- ${ticket_id}: status is '${state_name}' (type=${state_type}), must be Done/Closed."
    issue_failed=1
  fi

  if [ -z "$priority" ] || [ "$priority" = "0" ]; then
    echo "- ${ticket_id}: missing priority metadata."
    issue_failed=1
  fi

  if [ -z "$estimate" ] || [ "$estimate" = "null" ]; then
    echo "- ${ticket_id}: missing estimate metadata."
    issue_failed=1
  fi

  if [ -z "$assignee_id" ]; then
    echo "- ${ticket_id}: missing assignee metadata."
    issue_failed=1
  fi

  if [ -z "$due_date" ]; then
    echo "- ${ticket_id}: missing due date metadata."
    issue_failed=1
  fi

  if [ -z "$project_id" ]; then
    echo "- ${ticket_id}: missing project metadata."
    issue_failed=1
  elif [ "$project_id" != "$LINEAR_PROJECT_ID" ]; then
    echo "- ${ticket_id}: project mismatch (expected LINEAR_PROJECT_ID)."
    issue_failed=1
  fi

  if [ "${labels_count:-0}" -eq 0 ]; then
    echo "- ${ticket_id}: missing labels metadata."
    issue_failed=1
  fi

  if [ "$issue_failed" -eq 0 ]; then
    echo "- ${ticket_id}: OK (${issue_url})"
  else
    failures=$((failures + 1))
  fi
done

if [ "$failures" -gt 0 ]; then
  echo "Release readiness gate failed (${failures} ticket(s) with issues)."
  exit 1
fi

echo "Release readiness gate passed for ${RELEASE_TICKET}."
