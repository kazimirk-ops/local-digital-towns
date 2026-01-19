#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TEST_EMAIL="${TEST_EMAIL:-}"
ADMIN_LOGIN_EMAIL="${ADMIN_LOGIN_EMAIL:-$TEST_EMAIL}"

echo "BASE_URL=${BASE_URL}"

if [ -z "$TEST_EMAIL" ]; then
  echo "TEST_EMAIL env required (e.g. TEST_EMAIL=test@example.com)"
  exit 1
fi

echo "GET /health"
health_code=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/health" || true)
echo "health status: ${health_code}"

echo "POST /auth/request-link"
auth_body=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${TEST_EMAIL}\"}" \
  "${BASE_URL}/auth/request-link" || true)
echo "response: ${auth_body}"

if echo "$auth_body" | grep -q "\"magicUrl\""; then
  echo "magicUrl present (dev mode)."
else
  echo "magicUrl not present. In production, check Postmark Activity and server logs for MAGICLINK_SEND_ATTEMPT/RESULT."
fi

echo "POST /api/admin/test-email (no cookie, expect 401)"
noauth_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/admin/test-email" || true)
echo "status: ${noauth_code}"

if [ -n "${ADMIN_LOGIN_PASSPHRASE:-}" ]; then
  echo "POST /admin/login"
  cookie_jar=$(mktemp)
  login_resp=$(curl -s -i -c "$cookie_jar" -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "email=${ADMIN_LOGIN_EMAIL}" \
    --data-urlencode "passphrase=${ADMIN_LOGIN_PASSPHRASE}" \
    "${BASE_URL}/admin/login" || true)
  echo "admin login status: $(echo "$login_resp" | head -n 1)"
  if echo "$login_resp" | grep -q "Set-Cookie: sid="; then
    echo "sid cookie set"
  else
    echo "sid cookie not found"
  fi

  echo "POST /api/admin/test-email (with cookie, expect 200)"
  auth_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST -b "$cookie_jar" "${BASE_URL}/api/admin/test-email" || true)
  echo "status: ${auth_code}"
  rm -f "$cookie_jar"
else
  echo "ADMIN_LOGIN_PASSPHRASE not set; skipping admin login/test-email auth checks."
fi
