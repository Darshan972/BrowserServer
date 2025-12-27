#!/bin/bash

# Emergency fix for "Browser failed to start DevTools in 20000ms" error
# Run this on your Ubuntu server

echo "=================================="
echo "Emergency Browser Startup Fix"
echo "=================================="
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Run with sudo for full fixes"
    echo "Usage: sudo bash emergency-fix.sh"
fi

# 1. Kill any stuck Chrome processes
echo "1. Cleaning up stuck Chrome processes..."
pkill -9 chromium 2>/dev/null
pkill -9 chrome 2>/dev/null
KILLED=$(ps aux | grep -i chrome | grep -v grep | wc -l)
if [ "$KILLED" -gt 0 ]; then
    echo "   Killed $KILLED Chrome processes"
else
    echo "   No Chrome processes to kill"
fi
sleep 2

# 2. Clean up temp directories
echo ""
echo "2. Cleaning up temp browser directories..."
rm -rf /tmp/browser-* 2>/dev/null
CLEANED=$(find /tmp -name "browser-*" -type d 2>/dev/null | wc -l)
echo "   Cleaned up old browser directories"

# 3. Check/fix /dev/shm
echo ""
echo "3. Checking /dev/shm (shared memory)..."
SHM_SIZE=$(df -h /dev/shm | tail -1 | awk '{print $2}')
echo "   Current size: $SHM_SIZE"

if [[ "$SHM_SIZE" =~ M$ ]]; then
    echo "   ❌ TOO SMALL! This causes Chrome to crash"
    if [ "$EUID" -eq 0 ]; then
        echo "   Increasing to 8GB..."
        mount -o remount,size=8G /dev/shm
        echo "   ✅ Done! New size: $(df -h /dev/shm | tail -1 | awk '{print $2}')"
    else
        echo "   Run with sudo to fix: sudo mount -o remount,size=8G /dev/shm"
    fi
else
    echo "   ✅ Size is adequate"
fi

# 4. Check Xvfb
echo ""
echo "4. Checking Xvfb display..."
if pgrep -x "Xvfb" > /dev/null; then
    echo "   ✅ Xvfb is running"
    
    if xdpyinfo -display :99 >/dev/null 2>&1; then
        echo "   ✅ Display :99 is accessible"
    else
        echo "   ⚠️  Display :99 not accessible"
        if [ "$EUID" -eq 0 ]; then
            pkill Xvfb
            Xvfb :99 -screen 0 1346x766x24 -ac +extension GLX +render -noreset &
            sleep 2
            echo "   ✅ Restarted Xvfb"
        fi
    fi
else
    echo "   ❌ Xvfb NOT running"
    if [ "$EUID" -eq 0 ]; then
        Xvfb :99 -screen 0 1346x766x24 -ac +extension GLX +render -noreset &
        sleep 2
        echo "   ✅ Started Xvfb"
    else
        echo "   Run with sudo to start: sudo Xvfb :99 -screen 0 1346x766x24 &"
    fi
fi

# 5. Check Chrome installation
echo ""
echo "5. Verifying Chrome/Chromium..."
CHROME_PATH=""
for path in "/usr/bin/chromium-browser" "/usr/bin/chromium" "/usr/bin/google-chrome"; do
    if [ -f "$path" ]; then
        CHROME_PATH="$path"
        echo "   ✅ Found: $CHROME_PATH"
        break
    fi
done

if [ -z "$CHROME_PATH" ]; then
    echo "   ❌ Chrome/Chromium NOT FOUND!"
    echo "   Install: sudo apt-get install -y chromium-browser"
else
    # Test Chrome
    VERSION=$($CHROME_PATH --version 2>&1 | head -1)
    echo "   Version: $VERSION"
fi

# 6. Check system limits
echo ""
echo "6. Checking system limits..."
NOFILE=$(ulimit -n)
echo "   Max open files: $NOFILE"
if [ "$NOFILE" -lt 10000 ]; then
    echo "   ⚠️  Too low! Should be 100000+"
    echo "   Fix: Run setup-ubuntu.sh and reboot"
fi

# 7. Test Chrome startup
echo ""
echo "7. Testing Chrome startup..."
if [ -n "$CHROME_PATH" ]; then
    TEST_DIR="/tmp/test-chrome-$$"
    mkdir -p "$TEST_DIR"
    
    DISPLAY=:99 timeout 10s $CHROME_PATH \
        --headless=new \
        --no-sandbox \
        --disable-dev-shm-usage \
        --disable-gpu \
        --remote-debugging-port=9998 \
        --user-data-dir="$TEST_DIR" \
        about:blank > /tmp/chrome-startup-test.log 2>&1 &
    
    TEST_PID=$!
    sleep 5
    
    if curl -s "http://127.0.0.1:9998/json/version" >/dev/null 2>&1; then
        echo "   ✅ Chrome can start and respond!"
        kill $TEST_PID 2>/dev/null
    else
        echo "   ❌ Chrome failed to start or respond"
        echo "   Check log: /tmp/chrome-startup-test.log"
        if [ -f /tmp/chrome-startup-test.log ]; then
            echo ""
            echo "   Error output:"
            cat /tmp/chrome-startup-test.log
        fi
        kill $TEST_PID 2>/dev/null
    fi
    
    rm -rf "$TEST_DIR"
fi

# 8. Check for OOM kills
echo ""
echo "8. Checking for OOM (Out of Memory) kills..."
OOM_COUNT=$(dmesg | grep -i "killed process" | grep -i "chrome\|chromium" | wc -l)
if [ "$OOM_COUNT" -gt 0 ]; then
    echo "   ❌ Found $OOM_COUNT OOM kills!"
    echo "   Recent kills:"
    dmesg | grep -i "killed process" | grep -i "chrome\|chromium" | tail -3
    echo ""
    echo "   → This means Chrome is running out of memory"
    echo "   → Increase /dev/shm and check system RAM"
else
    echo "   ✅ No OOM kills detected"
fi

echo ""
echo "=================================="
echo "Next Steps:"
echo "=================================="
echo ""

# Check if .env exists
if [ -f .env ]; then
    CHROMIUM_PATH_ENV=$(grep "CHROMIUM_PATH=" .env | cut -d= -f2)
    if [ -n "$CHROMIUM_PATH_ENV" ] && [ -n "$CHROME_PATH" ]; then
        if [ "$CHROMIUM_PATH_ENV" != "$CHROME_PATH" ]; then
            echo "⚠️  .env CHROMIUM_PATH mismatch!"
            echo "   .env has: $CHROMIUM_PATH_ENV"
            echo "   Found at: $CHROME_PATH"
            echo "   Update .env file"
        fi
    fi
fi

if [ -z "$CHROME_PATH" ]; then
    echo "1. Install Chrome: sudo apt-get install chromium-browser"
elif ! xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "1. Fix Xvfb: sudo systemctl restart xvfb"
elif [[ "$SHM_SIZE" =~ M$ ]]; then
    echo "1. Fix /dev/shm: sudo mount -o remount,size=8G /dev/shm"
else
    echo "✅ All basic checks passed!"
    echo ""
    echo "Try restarting your server:"
    echo "  pm2 restart server"
    echo ""
    echo "If still failing, run full setup:"
    echo "  sudo bash setup-ubuntu.sh"
    echo "  sudo reboot"
fi

echo ""
