#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-http://localhost:3000}

assert_status() {
  local url="$1"
  local expected_regex="$2"
  local status
  status=$(curl -s -o /tmp/smoke_body.$$ -w "%{http_code}" "$url" || true)

  if [[ ! "$status" =~ $expected_regex ]]; then
    echo "FAIL: $url returned $status" >&2
    echo "Body:" >&2
    cat /tmp/smoke_body.$$ >&2
    rm -f /tmp/smoke_body.$$
    exit 1
  fi

  rm -f /tmp/smoke_body.$$
  echo "OK: $url ($status)"
}

assert_status_optional() {
  local url="$1"
  local expected_regex="$2"
  local optional_regex="$3"
  local status
  status=$(curl -s -o /tmp/smoke_body.$$ -w "%{http_code}" "$url" || true)

  if [[ "$status" =~ $expected_regex ]]; then
    rm -f /tmp/smoke_body.$$
    echo "OK: $url ($status)"
    return 0
  fi

  if [[ "$status" =~ $optional_regex ]]; then
    rm -f /tmp/smoke_body.$$
    echo "SKIP: $url ($status)"
    return 0
  fi

  echo "FAIL: $url returned $status" >&2
  echo "Body:" >&2
  cat /tmp/smoke_body.$$ >&2
  rm -f /tmp/smoke_body.$$
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
