#!/bin/bash

# Check your current server configuration
echo "========================================="
echo "Server Configuration Check"
echo "========================================="
echo ""

# Check .env file
if [ -f .env ]; then
    echo "📄 .env file contents:"
    echo "---"
    cat .env
    echo "---"
    echo ""
else
    echo "❌ .env file NOT FOUND!"
    echo ""
fi

# Check if server is running
echo "Server processes:"
pm2 list 2>/dev/null || ps aux | grep "node.*server" | grep -v grep

echo ""
echo "Environment variables (if server is running):"
pm2 env 0 2>/dev/null | grep -E "DOMAIN|PORT|CHROMIUM_PATH|MAX_BROWSERS" || echo "Run: pm2 env 0"

echo ""
echo "========================================="
echo "Test browser creation:"
echo "========================================="
echo ""

# Try to create a browser
echo "Attempting to create browser..."
RESPONSE=$(curl -X POST http://localhost:4000/browsers \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $(grep API_KEY .env 2>/dev/null | cut -d= -f2)" \
  -d '{"headful": false}' \
  -s -w "\nHTTP_CODE:%{http_code}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE")

echo "HTTP Status: $HTTP_CODE"
echo "Response:"
echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

echo ""
echo "========================================="
echo "Check PM2 logs for detailed errors:"
echo "========================================="
echo ""
echo "Run: pm2 logs server --lines 50"
