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

assert_status_with_cookie() {
  local url="$1"
  local expected_regex="$2"
  local cookie_file="$3"
  local status
  local body_file="/tmp/smoke_body.$$"
  local attempt
  for attempt in 1 2 3; do
    : > "$body_file"
    status=$(curl -s --max-time 30 --connect-timeout 10 -o "$body_file" -w "%{http_code}" -b "$cookie_file" "$url" || true)
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

post_json_expect_status() {
  local url="$1"
  local data="$2"
  local expected_regex="$3"
  local cookie_in="${4:-}"
  local cookie_out="${5:-}"
  local status
  local body_file="/tmp/smoke_body.$$"
  local attempt
  for attempt in 1 2 3; do
    : > "$body_file"
    status=$(curl -s --max-time 30 --connect-timeout 10 -o "$body_file" -w "%{http_code}" \
      ${cookie_in:+-b "$cookie_in"} ${cookie_out:+-c "$cookie_out"} \
      -H "Content-Type: application/json" -d "$data" "$url" || true)
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

fetch_json_with_cookie() {
  local url="$1"
  local cookie_file="$2"
  local status
  local body_file="/tmp/smoke_body.$$"
  local attempt
  for attempt in 1 2 3; do
    : > "$body_file"
    status=$(curl -s --max-time 30 --connect-timeout 10 -o "$body_file" -w "%{http_code}" -b "$cookie_file" "$url" || true)
    if [[ "$status" != "000" ]]; then
      break
    fi
    if [[ "$attempt" -lt 3 ]]; then
      sleep 2
    fi
  done

  if [[ "$status" != "200" ]]; then
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

  cat "$body_file"
  rm -f "$body_file"
}

assert_status "$BASE_URL/health" '^200$'
assert_status "$BASE_URL/ui" '^(200|302)$'

TEST_AUTH_CODE="${TEST_AUTH_CODE:-123456}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-${ADMIN_EMAILS%%,*}}"
if [[ -z "$ADMIN_EMAIL" ]]; then
  echo "FAIL: ADMIN_EMAILS not set" >&2
  exit 1
fi

ADMIN_COOKIE="/tmp/smoke_admin_cookie.$$"
MOD_COOKIE="/tmp/smoke_mod_cookie.$$"
USER_COOKIE="/tmp/smoke_user_cookie.$$"
MOD_EMAIL="mod+smoke@local.test"
USER_EMAIL="user+smoke@local.test"

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$ADMIN_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$ADMIN_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$ADMIN_COOKIE"

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$MOD_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$MOD_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$MOD_COOKIE"

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$USER_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$USER_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$USER_COOKIE"

assert_status_with_cookie "$BASE_URL/api/me" '^200$' "$MOD_COOKIE"
mod_me=$(fetch_json_with_cookie "$BASE_URL/api/me" "$MOD_COOKIE")
mod_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.user?.id||""));}catch(e){}' "$mod_me")
if [[ -z "$mod_id" ]]; then
  echo "FAIL: mod user id missing" >&2
  exit 1
fi

assert_status_with_cookie "$BASE_URL/api/me" '^200$' "$USER_COOKIE"
user_me=$(fetch_json_with_cookie "$BASE_URL/api/me" "$USER_COOKIE")
user_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.user?.id||""));}catch(e){}' "$user_me")
if [[ -z "$user_id" ]]; then
  echo "FAIL: user id missing" >&2
  exit 1
fi

post_json_expect_status "$BASE_URL/api/admin/trust/tiers" "{\"userId\":$mod_id,\"trustTier\":3}" '^200$' "$ADMIN_COOKIE" "$ADMIN_COOKIE"
post_json_expect_status "$BASE_URL/api/admin/trust/tiers" "{\"userId\":$user_id,\"trustTier\":2}" '^200$' "$ADMIN_COOKIE" "$ADMIN_COOKIE"

post_json_expect_status "$BASE_URL/api/mod/channels/1/mute" "{\"userId\":$user_id,\"reason\":\"smoke\"}" '^200$' "$MOD_COOKIE" "$MOD_COOKIE"
post_json_expect_status "$BASE_URL/channels/1/messages" "{\"text\":\"smoke muted\"}" '^403$' "$USER_COOKIE" "$USER_COOKIE"
post_json_expect_status "$BASE_URL/api/mod/channels/1/unmute" "{\"userId\":$user_id}" '^200$' "$MOD_COOKIE" "$MOD_COOKIE"
post_json_expect_status "$BASE_URL/channels/1/messages" "{\"text\":\"smoke unmuted\"}" '^201$' "$USER_COOKIE" "$USER_COOKIE"

# TODO (Phase 1): intake submission + approve/reject
# TODO (Phase 1): marketplace buy-it-now purchase
# TODO (Phase 1): giveaway draw + claim
# TODO (Phase 2): auctions payment due + ghost tracking
# TODO (Phase 2): uploads + public access
# TODO (Phase 2): pulse generation + archive
