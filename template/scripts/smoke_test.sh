#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_COOKIE="${AUTH_COOKIE:-}"
TIER1_COOKIE="${TIER1_COOKIE:-}"
TIER2_COOKIE="${TIER2_COOKIE:-}"

check() {
  local path="$1"
  local expected="$2"
  local method="${3:-GET}"
  local cookie="${4:-}"
  local code
  if [[ -n "$cookie" ]]; then
    code="$(curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Cookie: sid=${cookie}" "${BASE_URL}${path}" || true)"
  else
    code="$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "${BASE_URL}${path}" || true)"
  fi
  if [[ ! "$code" =~ ^(${expected})$ ]]; then
    echo "FAIL ${path} expected ${expected} got ${code}"
    exit 1
  fi
  echo "OK ${path} ${code}"
}

echo "== Public checks =="
check "/health" "200"
check "/ui" "200"
check "/signup" "200"
check "/store/102" "200|404"

echo "== Public APIs =="
check "/town/context" "200"
check "/districts/1/places" "200"
check "/api/pulse/latest" "200|404"

echo "== Auth-required (expect 401) =="
check "/api/uploads" "401" "POST"
check "/places/102/listings" "401" "POST"
check "/api/trust/apply" "401" "POST"
check "/api/cart" "401"
check "/api/cart/add" "401" "POST"
check "/api/checkout/create" "401" "POST"
check "/api/checkout/stripe" "401" "POST"
check "/api/orders/1/pay" "401" "POST"
check "/api/seller/sales/summary?placeId=1&range=7d" "401"
check "/api/admin/pulse/generate" "401" "POST"
check "/api/live/scheduled" "401"
check "/api/live/scheduled/1/bookmark" "401" "GET"
check "/api/live/scheduled/1/bookmark" "401" "POST"
check "/api/verify/location" "401" "POST"
check "/api/verify/resident" "401" "POST"
check "/api/admin/verify/resident/approve" "401" "POST"
check "/api/admin/verify/business/approve" "401" "POST"
check "/api/stripe/webhook" "400" "POST"

if [[ -n "$AUTH_COOKIE" ]]; then
  channel_id="$(curl -s -H "Cookie: sid=${AUTH_COOKIE}" "${BASE_URL}/channels" | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{try{const j=JSON.parse(d);console.log(j[0]?.id||"");}catch{console.log(\"\");}})')"
  if [[ -n "$channel_id" ]]; then
    check "/channels/${channel_id}/messages" "200" "GET" "$AUTH_COOKIE"
  else
    echo "SKIP /channels/:id/messages (no channels found)"
  fi
else
  echo "SKIP /channels/:id/messages (set AUTH_COOKIE)"
fi

echo "== Debug endpoints =="
if [[ -n "$AUTH_COOKIE" ]]; then
  check "/debug/routes" "200" "GET" "$AUTH_COOKIE"
  check "/debug/context" "200" "GET" "$AUTH_COOKIE"
else
  check "/debug/routes" "401|403"
  check "/debug/context" "401|403"
fi

echo "== Optional trust gating =="
if [[ -n "$TIER1_COOKIE" ]]; then
  check "/api/uploads" "403|429" "POST" "$TIER1_COOKIE"
else
  echo "SKIP Tier1 chat-image test (set TIER1_COOKIE)"
fi
if [[ -n "$TIER2_COOKIE" ]]; then
  check "/api/uploads" "200|400|415|422" "POST" "$TIER2_COOKIE"
else
  echo "SKIP Tier2 chat-image test (set TIER2_COOKIE)"
fi
