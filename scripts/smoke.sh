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

post_json_fetch() {
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

  cat "$body_file"
  rm -f "$body_file"
  echo "OK: $url ($status)" >&2
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
SMOKE_ADMIN_EMAIL="${SMOKE_ADMIN_EMAIL:-$ADMIN_EMAIL}"
if [[ -z "$ADMIN_EMAIL" ]]; then
  echo "FAIL: ADMIN_EMAILS not set" >&2
  exit 1
fi

ADMIN_COOKIE="/tmp/smoke_admin_cookie.$$"
MOD_COOKIE="/tmp/smoke_mod_cookie.$$"
USER_COOKIE="/tmp/smoke_user_cookie.$$"
MOD_EMAIL="mod+smoke@local.test"
USER_EMAIL="user+smoke@local.test"

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$SMOKE_ADMIN_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$SMOKE_ADMIN_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$ADMIN_COOKIE"

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

post_json_fetch "$BASE_URL/api/admin/sweep/rules" "{\"matchEventType\":\"channel_post\",\"enabled\":true,\"amount\":2}" '^201$' "$ADMIN_COOKIE" "$ADMIN_COOKIE" >/dev/null
post_json_fetch "$BASE_URL/api/admin/sweep/rules" "{\"matchEventType\":\"purchase\",\"enabled\":true,\"buyerAmount\":3}" '^201$' "$ADMIN_COOKIE" "$ADMIN_COOKIE" >/dev/null

post_json_expect_status "$BASE_URL/api/mod/channels/1/mute" "{\"userId\":$user_id,\"reason\":\"smoke\"}" '^200$' "$MOD_COOKIE" "$MOD_COOKIE"
post_json_expect_status "$BASE_URL/channels/1/messages" "{\"text\":\"smoke muted\"}" '^403$' "$USER_COOKIE" "$USER_COOKIE"
post_json_expect_status "$BASE_URL/api/mod/channels/1/unmute" "{\"userId\":$user_id}" '^200$' "$MOD_COOKIE" "$MOD_COOKIE"
user_balance_before_json=$(fetch_json_with_cookie "$BASE_URL/sweep/balance" "$USER_COOKIE")
user_balance_before=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.balance||0));}catch(e){}' "$user_balance_before_json")
post_json_expect_status "$BASE_URL/channels/1/messages" "{\"text\":\"smoke sweep post\"}" '^201$' "$USER_COOKIE" "$USER_COOKIE"
user_balance_after_json=$(fetch_json_with_cookie "$BASE_URL/sweep/balance" "$USER_COOKIE")
user_balance_after=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.balance||0));}catch(e){}' "$user_balance_after_json")
if [[ -z "$user_balance_before" || -z "$user_balance_after" ]]; then
  echo "FAIL: sweep balance missing" >&2
  exit 1
fi
if (( user_balance_after <= user_balance_before )); then
  echo "FAIL: sweep balance did not increase after channel post" >&2
  exit 1
fi

# Phase 2.3: buy-it-now checkout
SELLER_COOKIE="/tmp/smoke_seller_cookie.$$"
BUYER_COOKIE="/tmp/smoke_buyer_cookie.$$"
SMOKE_TIER2_EMAIL="${SMOKE_TIER2_EMAIL:-seller+smoke@local.test}"
SMOKE_BUYER_EMAIL="${SMOKE_BUYER_EMAIL:-buyer@test.local}"

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$SMOKE_TIER2_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$SMOKE_TIER2_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$SELLER_COOKIE"

seller_me=$(fetch_json_with_cookie "$BASE_URL/api/me" "$SELLER_COOKIE")
seller_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.user?.id||""));}catch(e){}' "$seller_me")
if [[ -z "$seller_id" ]]; then
  echo "FAIL: seller user id missing" >&2
  exit 1
fi

post_json_expect_status "$BASE_URL/api/admin/trust/tiers" "{\"userId\":$seller_id,\"trustTier\":2}" '^200$' "$ADMIN_COOKIE" "$ADMIN_COOKIE"

place_json=$(post_json_fetch "$BASE_URL/places" "{\"name\":\"Smoke Store\",\"category\":\"Test\",\"description\":\"Smoke store\"}" '^201$' "$SELLER_COOKIE" "$SELLER_COOKIE")
place_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); const id=j?.id ?? j?.place?.id ?? ""; process.stdout.write(String(id));}catch(e){}' "$place_json")
if [[ -z "$place_id" ]]; then
  echo "$place_json" >&2
  echo "FAIL: place id missing" >&2
  exit 1
fi

post_json_expect_status "$BASE_URL/api/admin/places/status" "{\"placeId\":$place_id,\"status\":\"approved\"}" '^200$' "$ADMIN_COOKIE" "$ADMIN_COOKIE"

listing_json=$(post_json_fetch "$BASE_URL/places/$place_id/listings" "{\"title\":\"Smoke Item\",\"description\":\"Smoke item\",\"price\":5,\"quantity\":2,\"listingType\":\"item\"}" '^201$' "$SELLER_COOKIE" "$SELLER_COOKIE")
listing_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); const id=j?.id ?? j?.listing?.id ?? ""; process.stdout.write(String(id));}catch(e){}' "$listing_json")
if [[ -z "$listing_id" ]]; then
  echo "$listing_json" >&2
  echo "FAIL: listing id missing" >&2
  exit 1
fi

post_json_expect_status "$BASE_URL/api/auth/request-code" "{\"email\":\"$SMOKE_BUYER_EMAIL\"}" '^200$'
post_json_expect_status "$BASE_URL/api/auth/verify-code" "{\"email\":\"$SMOKE_BUYER_EMAIL\",\"code\":\"$TEST_AUTH_CODE\"}" '^200$' "" "$BUYER_COOKIE"

buyer_me=$(fetch_json_with_cookie "$BASE_URL/api/me" "$BUYER_COOKIE")
buyer_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.user?.id||""));}catch(e){}' "$buyer_me")
if [[ -z "$buyer_id" ]]; then
  echo "FAIL: buyer user id missing" >&2
  exit 1
fi

post_json_expect_status "$BASE_URL/api/admin/trust/tiers" "{\"userId\":$buyer_id,\"trustTier\":1}" '^200$' "$ADMIN_COOKIE" "$ADMIN_COOKIE"

post_json_expect_status "$BASE_URL/api/cart/clear" "{}" '^200$' "$BUYER_COOKIE" "$BUYER_COOKIE"
post_json_expect_status "$BASE_URL/api/cart/add" "{\"listingId\":$listing_id,\"quantity\":1}" '^200$' "$BUYER_COOKIE" "$BUYER_COOKIE"

buyer_balance_before_json=$(fetch_json_with_cookie "$BASE_URL/sweep/balance" "$BUYER_COOKIE")
buyer_balance_before=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.balance||0));}catch(e){}' "$buyer_balance_before_json")

checkout_json=$(post_json_fetch "$BASE_URL/api/checkout/create" "{\"fulfillmentType\":\"pickup\"}" '^200$' "$BUYER_COOKIE" "$BUYER_COOKIE")
checkout_status=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.paymentStatus||""));}catch(e){}' "$checkout_json")
checkout_order_id=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.orderId||""));}catch(e){}' "$checkout_json")
if [[ "$checkout_status" != "requires_payment" || -z "$checkout_order_id" ]]; then
  echo "FAIL: checkout did not return requires_payment and orderId" >&2
  exit 1
fi
buyer_balance_after_json=$(fetch_json_with_cookie "$BASE_URL/sweep/balance" "$BUYER_COOKIE")
buyer_balance_after=$(node -e 'const s=process.argv[1]; try{const j=JSON.parse(s); process.stdout.write(String(j?.balance||0));}catch(e){}' "$buyer_balance_after_json")
if [[ -z "$buyer_balance_before" || -z "$buyer_balance_after" ]]; then
  echo "FAIL: buyer sweep balance missing" >&2
  exit 1
fi
if (( buyer_balance_after <= buyer_balance_before )); then
  echo "FAIL: sweep balance did not increase after checkout" >&2
  exit 1
fi

# TODO (Phase 1): intake submission + approve/reject
# TODO (Phase 1): giveaway draw + claim
# TODO (Phase 2): auctions payment due + ghost tracking
# TODO (Phase 2): uploads + public access
# TODO (Phase 2): pulse generation + archive
