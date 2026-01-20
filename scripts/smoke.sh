#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}

assert_status() {
  local url="$1"
  local expected_regex="$2"
  local status
  local body_file="/tmp/smoke_body.$$"
  local attempt
  for attempt in 1 2 3; do
    : > "$body_file"
    status=$(curl -s --max-time 30 --connect-timeout 10 -o "$body_file" -w "%{http_code}" "$url" || true)
    if [[ "$status" != "000" ]]; then
      break
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep 2
    fi
  done

  if [[ ! "$status" =~ $expected_regex ]]; then
    if [[ "$status" == "000" ]]; then
      echo "FAIL: Server not reachable ($url)" >&2
    else
      echo "FAIL: $url returned $status" >&2
      echo "Body:" >&2
      [ -f "$body_file" ] && cat "$body_file" >&2
    fi
    rm -f "$body_file"
    exit 1
  fi

  rm -f "$body_file"
  echo "OK: $url ($status)"
}

assert_status_optional() {
  local url="$1"
  local expected_regex="$2"
  local optional_regex="$3"
  local status
  local body_file="/tmp/smoke_body.$$"
  local attempt
  for attempt in 1 2 3; do
    : > "$body_file"
    status=$(curl -s --max-time 30 --connect-timeout 10 -o "$body_file" -w "%{http_code}" "$url" || true)
    if [[ "$status" != "000" ]]; then
      break
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep 2
    fi
  done

  if [[ "$status" =~ $expected_regex ]]; then
    rm -f "$body_file"
    echo "OK: $url ($status)"
    return 0
  fi

  if [[ "$status" =~ $optional_regex ]]; then
    rm -f "$body_file"
    echo "SKIP: $url ($status)"
    return 0
  fi

  if [[ "$status" == "000" ]]; then
    echo "FAIL: Server not reachable ($url)" >&2
  else
    echo "FAIL: $url returned $status" >&2
    echo "Body:" >&2
    [ -f "$body_file" ] && cat "$body_file" >&2
  fi
  rm -f "$body_file"
  exit 1
}

assert_status "$BASE_URL/health" '^200$'
assert_status "$BASE_URL/ui" '^(200|302)$'

# TODO (Phase 1): auth request/verify and /api/me
# TODO (Phase 1): admin permission gating
# TODO (Phase 1): intake submission + approve/reject
# TODO (Phase 1): marketplace buy-it-now purchase
# TODO (Phase 1): giveaway draw + claim
# TODO (Phase 2): auctions payment due + ghost tracking
# TODO (Phase 2): channel post + moderation
# TODO (Phase 2): uploads + public access
# TODO (Phase 2): pulse generation + archive
