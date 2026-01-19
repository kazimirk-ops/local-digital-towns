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
assert_status_optional "$BASE_URL/waitlist" '^200$' '^404$'
assert_status "$BASE_URL/ui" '^(200|302)$'

# TODO (Stage 1): auth request/verify and /api/me
# TODO (Stage 2): intake submission + admin approve/reject
# TODO (Stage 3): listing read + buy-it-now purchase
# TODO (Stage 4): auction bid + close
# TODO (Stage 5): giveaway entry + draw + claim
# TODO (Stage 6): channels post/read + pulse read
# TODO (Stage 7): admin permissions gating
# TODO (Stage 8): persistence checks across restart
