#!/bin/bash

# Quick Chrome Diagnostics - Run this on Ubuntu server when browser fails to start

echo "========================================="
echo "Chrome Browser Startup Diagnostics"
echo "========================================="
echo ""

# 1. Find Chrome/Chromium
echo "1. Looking for Chrome/Chromium..."
CHROME_PATH=""
for path in "/usr/bin/chromium-browser" "/usr/bin/chromium" "/usr/bin/google-chrome" "/usr/bin/google-chrome-stable" "/snap/bin/chromium"; do
    if [ -f "$path" ]; then
        echo "✅ Found: $path"
        CHROME_PATH="$path"
        break
    fi
done

if [ -z "$CHROME_PATH" ]; then
    echo "❌ Chrome/Chromium not found!"
    echo "Install with: sudo apt-get install chromium-browser"
    exit 1
fi

# 2. Test Chrome version
echo ""
echo "2. Testing Chrome version..."
$CHROME_PATH --version 2>&1 || echo "❌ Failed to get version"

# 3. Check Xvfb
echo ""
echo "3. Checking Xvfb display..."
if xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "✅ Xvfb display :99 is running"
else
    echo "❌ Xvfb display :99 NOT accessible"
    echo "Start with: Xvfb :99 -screen 0 1346x766x24 -ac +extension GLX +render -noreset &"
fi

# 4. Check /dev/shm
echo ""
echo "4. Checking shared memory..."
SHM_SIZE=$(df -h /dev/shm | tail -1 | awk '{print $2}')
SHM_USED=$(df -h /dev/shm | tail -1 | awk '{print $3}')
echo "Size: $SHM_SIZE (used: $SHM_USED)"
if [[ "$SHM_SIZE" =~ M$ ]]; then
    echo "⚠️  /dev/shm is too small! Should be 4G+"
    echo "Fix: sudo mount -o remount,size=8G /dev/shm"
fi

# 5. Test Chrome manually
echo ""
echo "5. Testing Chrome startup manually..."
TEST_DIR="/tmp/chrome-test-$$"
TEST_PORT=9999

mkdir -p "$TEST_DIR"

echo "Starting Chrome with test flags..."
DISPLAY=:99 $CHROME_PATH \
  --headless=new \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --remote-debugging-port=$TEST_PORT \
  --user-data-dir="$TEST_DIR" \
  about:blank > /tmp/chrome-test.log 2>&1 &

CHROME_PID=$!
echo "Chrome PID: $CHROME_PID"

# Wait for Chrome to start
echo "Waiting for Chrome DevTools..."
sleep 3

# Check if Chrome is still running
if kill -0 $CHROME_PID 2>/dev/null; then
    echo "✅ Chrome process is running"
    
    # Try to connect to DevTools
    if curl -s "http://127.0.0.1:$TEST_PORT/json/version" > /dev/null 2>&1; then
        echo "✅ Chrome DevTools responding on port $TEST_PORT"
        curl -s "http://127.0.0.1:$TEST_PORT/json/version" | head -5
    else
        echo "❌ Chrome started but DevTools not responding"
        echo "This is why your browsers timeout!"
    fi
    
    # Kill test Chrome
    kill $CHROME_PID 2>/dev/null
else
    echo "❌ Chrome process died immediately!"
    echo ""
    echo "Chrome error log:"
    cat /tmp/chrome-test.log
    echo ""
    echo "Check dmesg for OOM kills:"
    dmesg | tail -20 | grep -i "killed\|oom\|chrome\|chromium" || echo "No OOM messages"
fi

# Cleanup
rm -rf "$TEST_DIR"
rm -f /tmp/chrome-test.log

echo ""
echo "========================================="
echo "Common Issues & Fixes:"
echo "========================================="
echo ""
echo "Issue: Chrome crashes immediately"
echo "  → Check: dmesg | grep -i killed"
echo "  → Fix: Increase /dev/shm size"
echo ""
echo "Issue: DevTools not responding"
echo "  → Check: Xvfb is running"
echo "  → Fix: systemctl start xvfb"
echo ""
echo "Issue: Permission denied"
echo "  → Fix: Add --no-sandbox flag (already in code)"
echo ""
echo "Issue: Chrome not found"
echo "  → Fix: Update CHROMIUM_PATH in .env"
echo "  → Current: $CHROME_PATH"
echo ""
