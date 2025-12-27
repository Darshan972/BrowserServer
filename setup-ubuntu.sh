#!/bin/bash

# Browser Server Setup Script for Ubuntu Server
# Run this on your Hetzner Ubuntu server to fix all issues

set -e

echo "======================================"
echo "Browser Server - Ubuntu Setup Script"
echo "======================================"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "⚠️  Please run as root: sudo bash setup-ubuntu.sh"
    exit 1
fi

echo "✅ Running as root"
echo ""

# 1. Update system
echo "📦 Step 1/7: Updating system packages..."
apt-get update -qq

# 2. Install dependencies
echo "📦 Step 2/7: Installing Chromium and dependencies..."
apt-get install -y -qq \
  chromium-browser \
  xvfb \
  fonts-liberation \
  fonts-noto-color-emoji \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libatspi2.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
  libwayland-client0 \
  libxcomposite1 \
  libxdamage1 \
  libxfixes3 \
  libxkbcommon0 \
  libxrandr2 \
  xdg-utils

# Verify Chromium installation
CHROMIUM_PATH=$(which chromium-browser || which chromium || echo "")
if [ -z "$CHROMIUM_PATH" ]; then
    echo "❌ Chromium not found after installation!"
    exit 1
fi
echo "✅ Chromium installed at: $CHROMIUM_PATH"
echo ""

# 3. Configure system limits
echo "⚙️  Step 3/7: Configuring system limits..."

# Backup existing files
cp /etc/security/limits.conf /etc/security/limits.conf.backup.$(date +%s)
cp /etc/sysctl.conf /etc/sysctl.conf.backup.$(date +%s)

# Configure limits.conf
cat >> /etc/security/limits.conf << 'EOF'

# Browser Server - High Concurrency Limits
*    soft    nofile    100000
*    hard    nofile    100000
*    soft    nproc     50000
*    hard    nproc     50000
root soft    nofile    100000
root hard    nofile    100000
EOF

echo "✅ Updated /etc/security/limits.conf"

# Configure sysctl
cat >> /etc/sysctl.conf << 'EOF'

# Browser Server - System Limits
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
vm.max_map_count = 262144
kernel.pid_max = 4194304
net.ipv4.ip_local_port_range = 1024 65535
EOF

sysctl -p > /dev/null 2>&1
echo "✅ Updated /etc/sysctl.conf"
echo ""

# 4. Configure shared memory
echo "⚙️  Step 4/7: Configuring shared memory (/dev/shm)..."

# Check current /dev/shm size
CURRENT_SHM=$(df -h /dev/shm | tail -1 | awk '{print $2}')
echo "   Current /dev/shm size: $CURRENT_SHM"

# Remount with 8GB
mount -o remount,size=8G /dev/shm

# Make permanent in fstab
if grep -q "tmpfs.*\/dev\/shm" /etc/fstab; then
    # Update existing line
    sed -i 's|tmpfs.*/dev/shm.*tmpfs.*defaults.*|tmpfs  /dev/shm  tmpfs  defaults,size=8G  0  0|' /etc/fstab
else
    # Add new line
    echo "tmpfs  /dev/shm  tmpfs  defaults,size=8G  0  0" >> /etc/fstab
fi

NEW_SHM=$(df -h /dev/shm | tail -1 | awk '{print $2}')
echo "✅ /dev/shm resized to: $NEW_SHM"
echo ""

# 5. Setup Xvfb service
echo "⚙️  Step 5/7: Setting up Xvfb service..."

cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=X Virtual Frame Buffer Service
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/bin/Xvfb :99 -screen 0 1346x766x24 -ac +extension GLX +render -noreset
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable xvfb
systemctl restart xvfb

if systemctl is-active --quiet xvfb; then
    echo "✅ Xvfb service running"
else
    echo "⚠️  Xvfb service failed to start"
fi
echo ""

# 6. Display configuration summary
echo "📊 Step 6/7: Configuration Summary"
echo "======================================"
echo ""
echo "Chromium Path:     $CHROMIUM_PATH"
echo "Max Open Files:    $(ulimit -n 2>/dev/null || echo 'N/A - requires new shell')"
echo "Max Processes:     $(ulimit -u 2>/dev/null || echo 'N/A - requires new shell')"
echo "Shared Memory:     $(df -h /dev/shm | tail -1 | awk '{print $2}')"
echo "Xvfb Status:       $(systemctl is-active xvfb)"
echo ""

# 7. Create .env file if it doesn't exist
echo "⚙️  Step 7/7: Creating .env file..."

if [ ! -f .env ]; then
    cat > .env << EOF
# Browser Server Configuration
DOMAIN=your-domain.com
PORT=3000

# Browser Pool
MAX_BROWSERS=100
BROWSER_IDLE_TIMEOUT=300000

# Chromium Path
CHROMIUM_PATH=$CHROMIUM_PATH

# API Security - CHANGE THIS!
API_KEY=change-this-secret-key

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_CREATE_MAX=100

# WebSocket Rate Limiting
WSS_RATE_LIMIT_MAX_CONNECTIONS=100
WSS_RATE_LIMIT_MAX_MESSAGES=5000

# Environment
NODE_ENV=production
EOF
    echo "✅ Created .env file - PLEASE UPDATE API_KEY!"
else
    echo "⚠️  .env file already exists, skipping..."
fi
echo ""

# Completion message
echo "======================================"
echo "✅ Setup Complete!"
echo "======================================"
echo ""
echo "⚠️  IMPORTANT: You must REBOOT the server for all changes to take effect:"
echo ""
echo "    sudo reboot"
echo ""
echo "After reboot:"
echo "  1. Update .env file with your settings"
echo "  2. Start your server: npm start"
echo "  3. Test: curl http://localhost:3000/health"
echo ""
echo "Verification commands:"
echo "  ulimit -n          # Should show 100000"
echo "  ulimit -u          # Should show 50000"
echo "  df -h /dev/shm     # Should show 8G"
echo "  ps aux | grep Xvfb # Should show Xvfb running"
echo ""
