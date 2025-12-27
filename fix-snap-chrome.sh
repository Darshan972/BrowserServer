#!/bin/bash

echo "========================================="
echo "Snap Chrome Port Range Fix"
echo "========================================="
echo ""

# Check if Chrome is snap
if snap list chromium 2>/dev/null; then
    echo "✅ Chromium is installed via Snap"
    echo ""
    
    # The issue: Snap Chrome may have restrictions on port ranges
    # Your code uses ports 9000-19000, but snap might block some
    
    echo "Checking port availability in 9000-19000 range..."
    
    # Test if we can bind to ports in that range
    for port in 9000 9500 10000 15000 18000; do
        if timeout 1 nc -l $port 2>/dev/null & then
            PID=$!
            sleep 0.5
            kill $PID 2>/dev/null
            echo "  ✅ Port $port is accessible"
        else
            echo "  ❌ Port $port might be blocked"
        fi
    done
    
    echo ""
    echo "========================================="
    echo "Recommended Fix: Use regular .deb Chrome"
    echo "========================================="
    echo ""
    echo "Snap has sandboxing that may interfere."
    echo ""
    echo "To replace Snap Chrome with .deb version:"
    echo ""
    echo "  # Remove snap Chrome"
    echo "  sudo snap remove chromium"
    echo ""
    echo "  # Install .deb Chrome"
    echo "  sudo apt update"
    echo "  sudo apt install -y chromium-browser"
    echo ""
    echo "  # OR install Google Chrome"
    echo "  wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
    echo "  sudo dpkg -i google-chrome-stable_current_amd64.deb"
    echo "  sudo apt-get install -f"
    echo ""
    echo "Then update .env:"
    echo "  CHROMIUM_PATH=/usr/bin/chromium-browser"
    echo "  # or"
    echo "  CHROMIUM_PATH=/usr/bin/google-chrome"
    echo ""
else
    echo "Chromium is NOT a snap package - good!"
fi

echo ""
echo "========================================="
echo "Alternative: Check actual Chrome errors"
echo "========================================="
echo ""
echo "The diagnostic showed Chrome CAN start."
echo "The issue might be:"
echo ""
echo "1. Port already in use"
echo "   Check: netstat -tulpn | grep 9000"
echo ""
echo "2. Too many Chrome processes"
echo "   Check: ps aux | grep chromium | wc -l"
echo "   Fix: pkill -9 chromium"
echo ""
echo "3. Timing issue - Chrome takes longer than 500ms"
echo "   (Code waits 500ms between retries)"
echo ""
echo "4. process.env.DOMAIN not set"
echo "   Check your .env file has DOMAIN=browser.scrapingdog.com"
echo ""

# Check current Chrome count
CHROME_COUNT=$(ps aux | grep -i chromium | grep -v grep | wc -l)
echo "Current Chrome processes: $CHROME_COUNT"

if [ "$CHROME_COUNT" -gt 50 ]; then
    echo "⚠️  Warning: $CHROME_COUNT Chrome processes running!"
    echo "This might cause issues. Consider cleaning up:"
    echo "  sudo pkill -9 chromium"
fi

echo ""
