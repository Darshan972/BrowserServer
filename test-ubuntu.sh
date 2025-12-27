#!/bin/bash

# Quick diagnostic script to check Ubuntu server configuration

echo "======================================"
echo "Browser Server - Ubuntu Diagnostics"
echo "======================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. Chromium Path
echo "1. Chromium Installation"
echo "------------------------"
CHROMIUM_PATH=$(which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo "")
if [ -n "$CHROMIUM_PATH" ]; then
    check_pass "Chromium found: $CHROMIUM_PATH"
    $CHROMIUM_PATH --version 2>/dev/null || check_warn "Cannot get version"
else
    check_fail "Chromium not found! Install: sudo apt-get install chromium-browser"
fi
echo ""

# 2. System Limits
echo "2. System Limits"
echo "----------------"
NOFILE=$(ulimit -n 2>/dev/null || echo "0")
NPROC=$(ulimit -u 2>/dev/null || echo "0")

if [ "$NOFILE" -ge 100000 ]; then
    check_pass "Max open files: $NOFILE"
else
    check_fail "Max open files too low: $NOFILE (need 100000+)"
fi

if [ "$NPROC" -ge 50000 ]; then
    check_pass "Max processes: $NPROC"
else
    check_fail "Max processes too low: $NPROC (need 50000+)"
fi
echo ""

# 3. Shared Memory
echo "3. Shared Memory"
echo "----------------"
SHM_SIZE=$(df -h /dev/shm 2>/dev/null | tail -1 | awk '{print $2}' || echo "0")
SHM_USED=$(df -h /dev/shm 2>/dev/null | tail -1 | awk '{print $3}' || echo "0")
SHM_AVAIL=$(df -h /dev/shm 2>/dev/null | tail -1 | awk '{print $4}' || echo "0")

echo "/dev/shm size: $SHM_SIZE (used: $SHM_USED, available: $SHM_AVAIL)"
if [[ "$SHM_SIZE" =~ ^[0-9.]+G$ ]] && [[ "${SHM_SIZE%G}" -ge 4 ]]; then
    check_pass "/dev/shm is large enough"
else
    check_fail "/dev/shm too small: $SHM_SIZE (need 4G+)"
fi
echo ""

# 4. Xvfb
echo "4. Xvfb Virtual Display"
echo "-----------------------"
if pgrep -x "Xvfb" > /dev/null; then
    check_pass "Xvfb is running"
    ps aux | grep Xvfb | grep -v grep
    
    if xdpyinfo -display :99 >/dev/null 2>&1; then
        check_pass "Display :99 is accessible"
    else
        check_warn "Display :99 not accessible"
    fi
else
    check_fail "Xvfb not running! Start: sudo systemctl start xvfb"
fi
echo ""

# 5. Port Availability
echo "5. Port Availability"
echo "--------------------"
PORT_3000=$(netstat -tuln 2>/dev/null | grep ":3000 " || echo "")
if [ -z "$PORT_3000" ]; then
    check_pass "Port 3000 is available"
else
    check_warn "Port 3000 already in use"
fi

# Check if a large port range is available (for Chrome debugging)
USED_PORTS=$(netstat -tuln 2>/dev/null | grep -E ":(900[0-9]|9[0-9]{3}|1[0-8][0-9]{3}|19000)" | wc -l)
echo "Ports in 9000-19000 range currently used: $USED_PORTS / 10000"
if [ "$USED_PORTS" -lt 9000 ]; then
    check_pass "Sufficient ports available"
else
    check_fail "Port exhaustion! $USED_PORTS ports used"
fi
echo ""

# 6. Dependencies
echo "6. Required Libraries"
echo "---------------------"
LIBS=("libnss3" "libgbm1" "libatk-bridge2.0-0" "libgtk-3-0" "libxcomposite1")
MISSING=0
for lib in "${LIBS[@]}"; do
    if dpkg -l | grep -q "^ii.*$lib"; then
        check_pass "$lib installed"
    else
        check_fail "$lib MISSING!"
        MISSING=$((MISSING + 1))
    fi
done
echo ""

# 7. Memory & CPU
echo "7. System Resources"
echo "-------------------"
TOTAL_RAM=$(free -h | awk '/^Mem:/ {print $2}')
AVAIL_RAM=$(free -h | awk '/^Mem:/ {print $7}')
CPU_COUNT=$(nproc)

echo "Total RAM: $TOTAL_RAM"
echo "Available RAM: $AVAIL_RAM"
echo "CPU Cores: $CPU_COUNT"

if [ "$CPU_COUNT" -ge 16 ]; then
    check_pass "Sufficient CPU cores for 100+ browsers"
elif [ "$CPU_COUNT" -ge 8 ]; then
    check_pass "Sufficient CPU cores for 50+ browsers"
else
    check_warn "Limited CPU cores for many browsers"
fi
echo ""

# 8. Chrome Process Count
echo "8. Current Chrome Processes"
echo "---------------------------"
CHROME_COUNT=$(ps aux | grep -i chromium | grep -v grep | wc -l)
echo "Running Chromium processes: $CHROME_COUNT"

if [ "$CHROME_COUNT" -gt 0 ]; then
    echo ""
    echo "Sample processes:"
    ps aux | grep -i chromium | grep -v grep | head -5
fi
echo ""

# 9. .env File
echo "9. Configuration File"
echo "---------------------"
if [ -f .env ]; then
    check_pass ".env file exists"
    
    if grep -q "API_KEY=change-this" .env 2>/dev/null; then
        check_warn "API_KEY still has default value!"
    fi
    
    MAX_BROWSERS=$(grep "MAX_BROWSERS=" .env 2>/dev/null | cut -d= -f2)
    if [ -n "$MAX_BROWSERS" ]; then
        echo "MAX_BROWSERS: $MAX_BROWSERS"
    fi
else
    check_fail ".env file missing! Copy from .env.example"
fi
echo ""

# Summary
echo "======================================"
echo "Summary"
echo "======================================"
echo ""

# Count issues
CRITICAL_ISSUES=0
if [ -z "$CHROMIUM_PATH" ]; then CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1)); fi
if [ "$NOFILE" -lt 100000 ]; then CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1)); fi
if ! pgrep -x "Xvfb" > /dev/null; then CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1)); fi
if [ "$MISSING" -gt 0 ]; then CRITICAL_ISSUES=$((CRITICAL_ISSUES + 1)); fi

if [ "$CRITICAL_ISSUES" -eq 0 ]; then
    check_pass "All critical checks passed!"
    echo ""
    echo "Your server should be able to handle 50-100+ browsers."
    echo ""
    echo "Next steps:"
    echo "  1. Update .env file with your settings"
    echo "  2. Start server: npm start"
    echo "  3. Test: curl http://localhost:3000/health"
else
    check_fail "Found $CRITICAL_ISSUES critical issue(s)"
    echo ""
    echo "Run the setup script to fix issues:"
    echo "  sudo bash setup-ubuntu.sh"
    echo "  sudo reboot"
fi
echo ""
