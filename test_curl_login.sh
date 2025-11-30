#!/bin/bash

USER_EMAIL="lucascardoso01@proton.me"
PASSWORD="!Senha123"

echo "=== UTMify Curl Login Test ==="
echo "User: $USER_EMAIL"
echo ""

# First, get the login page and look for API info
echo "1. Fetching login page..."
LOGIN_PAGE=$(curl -sk "https://app.utmify.com.br/login/" 2>&1)
echo "   Page fetched, length: ${#LOGIN_PAGE}"

# Find JS files
echo ""
echo "2. Looking for JS bundles..."
JS_FILES=$(echo "$LOGIN_PAGE" | grep -oE '_app/immutable/[^"]+\.js' | head -5)
echo "   Found JS files:"
echo "$JS_FILES" | while read js; do
  echo "   - $js"
done

# Analyze the main app.js for API endpoints
echo ""
echo "3. Analyzing app.js for API endpoints..."
APP_JS=$(curl -sk "https://app.utmify.com.br/_app/immutable/entry/app.lDrsfXEf.js" 2>&1)
echo "   App.js length: ${#APP_JS}"

# Look for API endpoints
API_ENDPOINTS=$(echo "$APP_JS" | grep -oE '"/api/[^"]+' | head -20)
echo "   API endpoints found:"
echo "$API_ENDPOINTS" | while read ep; do
  echo "   $ep"
done

# Look for auth-related patterns
echo ""
echo "4. Looking for auth patterns in JS..."
AUTH_PATTERNS=$(echo "$APP_JS" | grep -oiE '"[^"]*auth[^"]*"' | sort -u | head -10)
echo "$AUTH_PATTERNS" | while read ap; do
  echo "   $ap"
done

# Try common login endpoints
echo ""
echo "5. Testing login endpoints..."

ENDPOINTS=(
  "https://app.utmify.com.br/api/auth/login"
  "https://app.utmify.com.br/api/v1/auth/login"
  "https://app.utmify.com.br/api/login"
  "https://app.utmify.com.br/api/sessions"
)

for endpoint in "${ENDPOINTS[@]}"; do
  echo ""
  echo "   Testing: $endpoint"

  # Try with email/password
  RESPONSE=$(curl -sk -X POST "$endpoint" \
    -H "Content-Type: application/json" \
    -H "Origin: https://app.utmify.com.br" \
    -H "Referer: https://app.utmify.com.br/login/" \
    -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$PASSWORD\"}" \
    -w "\n---STATUS:%{http_code}---" 2>&1)

  STATUS=$(echo "$RESPONSE" | grep -oE 'STATUS:[0-9]+' | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed 's/---STATUS:[0-9]*---$//')

  echo "   Status: $STATUS"
  if [ "$STATUS" != "404" ] && [ "$STATUS" != "405" ]; then
    echo "   Response: ${BODY:0:500}"

    if [ "$STATUS" == "200" ] || [ "$STATUS" == "201" ]; then
      echo ""
      echo "✅ LOGIN SUCCESSFUL!"

      # Extract token if present
      TOKEN=$(echo "$BODY" | grep -oE '"(token|access_token|accessToken)":"[^"]+"' | head -1 | cut -d'"' -f4)
      if [ -n "$TOKEN" ]; then
        echo "   Token: ${TOKEN:0:50}..."

        echo ""
        echo "6. Fetching dashboard data with token..."

        DASH_ENDPOINTS=(
          "/api/dashboard"
          "/api/v1/dashboard"
          "/api/me"
          "/api/user"
          "/api/stats"
        )

        for dash in "${DASH_ENDPOINTS[@]}"; do
          echo ""
          echo "   GET https://app.utmify.com.br$dash"
          DASH_RESPONSE=$(curl -sk "https://app.utmify.com.br$dash" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/json" \
            -w "\n---STATUS:%{http_code}---" 2>&1)

          DASH_STATUS=$(echo "$DASH_RESPONSE" | grep -oE 'STATUS:[0-9]+' | cut -d: -f2)
          DASH_BODY=$(echo "$DASH_RESPONSE" | sed 's/---STATUS:[0-9]*---$//')

          echo "   Status: $DASH_STATUS"
          if [ "$DASH_STATUS" == "200" ]; then
            echo "   ✅ Data:"
            echo "${DASH_BODY:0:2000}"
          fi
        done
      fi

      exit 0
    fi
  fi
done

echo ""
echo "❌ No working login endpoint found"
echo ""
echo "=== Test Complete ==="
