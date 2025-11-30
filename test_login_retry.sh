#!/bin/bash

USER_EMAIL="lucascardoso01@proton.me"
PASSWORD='!Senha123'

echo "=== UTMify Login Test (with retries) ==="
echo "User: $USER_EMAIL"
echo ""

# Function to make request with retries
retry_curl() {
  local url="$1"
  local method="${2:-GET}"
  local data="$3"
  local max_retries=5
  local retry=0

  while [ $retry -lt $max_retries ]; do
    if [ "$method" == "POST" ]; then
      RESPONSE=$(curl -sk --max-time 15 -X POST "$url" \
        -H "Content-Type: application/json" \
        -H "Origin: https://app.utmify.com.br" \
        -H "Referer: https://app.utmify.com.br/login/" \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        -d "$data" \
        -w "\n---HTTP_CODE:%{http_code}---" 2>&1)
    else
      RESPONSE=$(curl -sk --max-time 15 "$url" \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
        -w "\n---HTTP_CODE:%{http_code}---" 2>&1)
    fi

    if ! echo "$RESPONSE" | grep -q "TLS_error\|CERTIFICATE_VERIFY\|reset before headers"; then
      echo "$RESPONSE"
      return 0
    fi

    retry=$((retry + 1))
    sleep 1
  done

  echo "ERROR: Failed after $max_retries retries"
  return 1
}

# First, get the login page
echo "1. Fetching login page..."
LOGIN_PAGE=$(retry_curl "https://app.utmify.com.br/login/")

if echo "$LOGIN_PAGE" | grep -q "ERROR: Failed"; then
  echo "   Failed to fetch login page"
  exit 1
fi

PAGE_LENGTH=$(echo "$LOGIN_PAGE" | wc -c)
echo "   Page length: $PAGE_LENGTH bytes"

# Get the start.js file which likely has the login logic
echo ""
echo "2. Fetching start.js for API analysis..."
START_JS=$(retry_curl "https://app.utmify.com.br/_app/immutable/entry/start.UVFtNW9f.js")

if ! echo "$START_JS" | grep -q "ERROR: Failed"; then
  START_LENGTH=$(echo "$START_JS" | wc -c)
  echo "   start.js length: $START_LENGTH bytes"

  # Look for API patterns
  echo "   Searching for API endpoints..."
  API_MATCHES=$(echo "$START_JS" | grep -oE '"/api/[^"]+"|/api/[a-zA-Z0-9/_-]+' | sort -u | head -15)
  if [ -n "$API_MATCHES" ]; then
    echo "   Found API patterns:"
    echo "$API_MATCHES" | while read match; do
      echo "   - $match"
    done
  fi
fi

# Get the auth chunk
echo ""
echo "3. Fetching AuthUserAction chunk..."
AUTH_JS=$(retry_curl "https://app.utmify.com.br/_app/immutable/chunks/AuthUserAction.KftnIIHa.js")

if ! echo "$AUTH_JS" | grep -q "ERROR: Failed"; then
  AUTH_LENGTH=$(echo "$AUTH_JS" | wc -c)
  echo "   AuthUserAction.js length: $AUTH_LENGTH bytes"

  # Look for login-related patterns
  echo "   Searching for login patterns..."
  LOGIN_PATTERNS=$(echo "$AUTH_JS" | grep -oiE '"[^"]*login[^"]*"|fetch\([^)]+|/api/[a-zA-Z0-9/_-]+' | head -20)
  if [ -n "$LOGIN_PATTERNS" ]; then
    echo "   Found login patterns:"
    echo "$LOGIN_PATTERNS" | head -10 | while read match; do
      echo "   - $match"
    done
  fi

  # Save for analysis
  echo "$AUTH_JS" > /tmp/auth_js.txt
  echo "   Saved to /tmp/auth_js.txt for analysis"
fi

# Try various API endpoints
echo ""
echo "4. Testing login API endpoints..."

# Common endpoint patterns
ENDPOINTS=(
  "https://app.utmify.com.br/api/auth/login"
  "https://app.utmify.com.br/api/auth/signin"
  "https://app.utmify.com.br/api/v1/auth/login"
  "https://app.utmify.com.br/api/v1/auth/signin"
  "https://app.utmify.com.br/api/login"
  "https://app.utmify.com.br/api/signin"
  "https://app.utmify.com.br/api/sessions"
  "https://app.utmify.com.br/api/v1/sessions"
  "https://app.utmify.com.br/api/users/login"
  "https://app.utmify.com.br/api/users/signin"
  "https://app.utmify.com.br/api/authenticate"
  "https://app.utmify.com.br/api/v1/authenticate"
)

# Different payload formats to try
for endpoint in "${ENDPOINTS[@]}"; do
  echo ""
  echo "   Testing: $endpoint"

  # Try email/password format
  PAYLOAD="{\"email\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}"
  RESULT=$(retry_curl "$endpoint" "POST" "$PAYLOAD")

  HTTP_CODE=$(echo "$RESULT" | grep -oE 'HTTP_CODE:[0-9]+' | cut -d: -f2)
  BODY=$(echo "$RESULT" | sed 's/---HTTP_CODE:[0-9]*---$//')

  echo "   email/password -> Status: $HTTP_CODE"

  if [ "$HTTP_CODE" != "404" ] && [ "$HTTP_CODE" != "405" ] && [ "$HTTP_CODE" != "000" ]; then
    echo "   Response: ${BODY:0:300}"

    if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
      echo ""
      echo "✅ LOGIN SUCCESSFUL with $endpoint!"
      echo ""
      echo "Full response:"
      echo "$BODY" | head -c 2000

      # Extract token
      TOKEN=$(echo "$BODY" | grep -oE '"(token|access_token|accessToken)"\s*:\s*"[^"]+"' | head -1 | sed 's/.*:.*"\([^"]*\)".*/\1/')

      if [ -n "$TOKEN" ]; then
        echo ""
        echo "Token: ${TOKEN:0:50}..."
        echo ""
        echo "5. Fetching dashboard data..."

        for dash_path in "/api/dashboard" "/api/v1/dashboard" "/api/me" "/api/user" "/api/account" "/api/stats" "/api/metrics"; do
          echo ""
          echo "   GET $dash_path"
          DASH_RESULT=$(curl -sk --max-time 15 "https://app.utmify.com.br$dash_path" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/json" \
            -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
            -w "\n---HTTP_CODE:%{http_code}---" 2>&1)

          DASH_CODE=$(echo "$DASH_RESULT" | grep -oE 'HTTP_CODE:[0-9]+' | cut -d: -f2)
          DASH_BODY=$(echo "$DASH_RESULT" | sed 's/---HTTP_CODE:[0-9]*---$//')

          echo "   Status: $DASH_CODE"
          if [ "$DASH_CODE" == "200" ]; then
            echo "   ✅ Data:"
            echo "${DASH_BODY:0:3000}"
          fi
        done
      fi

      exit 0
    fi
  fi

  # Also try senha instead of password (Portuguese)
  PAYLOAD="{\"email\":\"$USER_EMAIL\",\"senha\":\"$PASSWORD\"}"
  RESULT=$(retry_curl "$endpoint" "POST" "$PAYLOAD")

  HTTP_CODE=$(echo "$RESULT" | grep -oE 'HTTP_CODE:[0-9]+' | cut -d: -f2)

  if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "201" ]; then
    BODY=$(echo "$RESULT" | sed 's/---HTTP_CODE:[0-9]*---$//')
    echo ""
    echo "✅ LOGIN SUCCESSFUL with email/senha format!"
    echo "$BODY" | head -c 2000
    exit 0
  fi
done

echo ""
echo "❌ No working login endpoint found"
echo ""
echo "=== Test Complete ==="
