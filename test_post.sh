#!/bin/bash
set +H

PASSWORD_ENCODED="%21Senha123"

for i in 1 2 3 4 5; do
  RESULT=$(curl -sk --max-time 30 -X POST "https://app.utmify.com.br/login/" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -H "Origin: https://app.utmify.com.br" \
    -H "Referer: https://app.utmify.com.br/login/" \
    --data-raw "email=lucascardoso01@proton.me&password=${PASSWORD_ENCODED}" \
    -w "\n---HTTP_STATUS:%{http_code}---" 2>&1)

  if ! echo "$RESULT" | grep -q "TLS_error"; then
    HTTP_CODE=$(echo "$RESULT" | grep -oE 'HTTP_STATUS:[0-9]+' | cut -d: -f2)
    BODY=$(echo "$RESULT" | sed 's/---HTTP_STATUS:[0-9]*---$//')
    echo "POST /login/ -> Status: $HTTP_CODE"
    echo "Response (first 500 chars):"
    echo "${BODY:0:500}"
    exit 0
  fi
  echo "Retry $i..."
  sleep 1
done

echo "Failed after 5 retries"
