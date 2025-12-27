# Ubuntu Server Browser Issues - Diagnosis & Fixes

## 🔴 CRITICAL ISSUES IDENTIFIED

Your 32 CPU / 128GB RAM Hetzner server **should easily handle 100+ browsers**, but I found several blocking issues:

---

## Issue #1: ❌ Wrong Chromium Path (CRITICAL)
**Current:** `/usr/bin/Chromium-browser` (case-sensitive, likely wrong)
**Ubuntu paths:**
- `/usr/bin/chromium-browser` (lowercase)
- `/usr/bin/chromium`
- `/snap/bin/chromium`

### Fix:
```bash
# Find your actual Chromium path
which chromium-browser
# or
which chromium
# or
ls -la /usr/bin/chrom*
```

Then set in `.env`:
```bash
CHROMIUM_PATH=/usr/bin/chromium-browser
```

---

## Issue #2: ❌ Listening Only on 127.0.0.1 (CRITICAL)
**Current in server.js:**
```javascript
server.listen(port, '127.0.0.1', () => {
```

This means **your server only accepts connections from localhost**, not from external clients!

### Fix:
```javascript
server.listen(port, '0.0.0.0', () => {
```

---

## Issue #3: ❌ Insufficient Chrome Launch Args
Your current Chrome args are minimal and will cause OOM (Out Of Memory) kills on Ubuntu.

### Current Args (PROBLEMATIC):
```javascript
const args = [
  `--remote-debugging-address=127.0.0.1`,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${dataDir}`,
  `--window-size=1346,766`,
  headful ? '--disable-headless' : '--headless=new',
  `--disk-cache-size=67108864`,
  `--media-cache-size=33554432`
];
```

### Optimized Args for Ubuntu Server (50+ browsers):
```javascript
const args = [
  `--remote-debugging-address=127.0.0.1`,
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${dataDir}`,
  `--window-size=1346,766`,
  headful ? '--disable-headless' : '--headless=new',
  
  // ✅ Memory & Performance
  '--disable-dev-shm-usage',        // CRITICAL: Fixes /dev/shm too small
  '--no-sandbox',                   // CRITICAL for Docker/Ubuntu servers
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-accelerated-2d-canvas',
  '--no-zygote',                    // Reduces memory overhead
  '--single-process',               // Each browser is isolated (IMPORTANT)
  
  // ✅ Cache & Disk
  '--disk-cache-size=33554432',     // 32MB (reduced)
  '--media-cache-size=16777216',    // 16MB (reduced)
  '--disable-application-cache',
  
  // ✅ Disable Unnecessary Features
  '--disable-extensions',
  '--disable-plugins',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--disable-notifications',
  '--disable-logging',
  '--disable-permissions-api',
  
  // ✅ Font & Rendering (reduces memory)
  '--font-render-hinting=none',
  '--disable-webgl',
  '--disable-webgl2'
];

if (proxyServer) {
  args.push(`--proxy-server=${proxyServer}`);
}
```

---

## Issue #4: ❌ System Limits (CRITICAL)

Ubuntu has strict limits that prevent running many processes:

### Check Current Limits:
```bash
ulimit -n     # Open files (should be 100000+)
ulimit -u     # Max processes (should be 50000+)
cat /proc/sys/fs/file-max
cat /proc/sys/kernel/pid_max
```

### Fix System Limits:
```bash
# Edit limits config
sudo nano /etc/security/limits.conf
```

Add these lines at the end:
```
*    soft    nofile    100000
*    hard    nofile    100000
*    soft    nproc     50000
*    hard    nproc     50000
root soft    nofile    100000
root hard    nofile    100000
```

```bash
# Edit sysctl
sudo nano /etc/sysctl.conf
```

Add:
```
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
vm.max_map_count = 262144
kernel.pid_max = 4194304
net.ipv4.ip_local_port_range = 1024 65535
```

Apply:
```bash
sudo sysctl -p
```

**REBOOT REQUIRED** after these changes:
```bash
sudo reboot
```

---

## Issue #5: ❌ Shared Memory Too Small

Chrome needs `/dev/shm` (shared memory) but Ubuntu defaults to 64MB.

### Check Current Size:
```bash
df -h /dev/shm
```

### Fix: Increase /dev/shm to 8GB
```bash
sudo mount -o remount,size=8G /dev/shm
```

### Make Permanent:
```bash
sudo nano /etc/fstab
```

Add or modify the line:
```
tmpfs  /dev/shm  tmpfs  defaults,size=8G  0  0
```

---

## Issue #6: ⚠️ Missing Dependencies

```bash
# Install required libraries
sudo apt-get update
sudo apt-get install -y \
  chromium-browser \
  xvfb \
  fonts-liberation \
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
```

---

## Issue #7: ❌ Port Range Too Small

You're using ports 8000-8100 (only 100 ports for debugging + websocket).

### Fix in browserPool.js:
```javascript
// Change from:
const ports = portNumbers(8000, 8100);

// To:
const ports = portNumbers(9000, 19000);  // 10,000 available ports
```

---

## Issue #8: ❌ Xvfb Not Optimized

Your Xvfb may not be configured for high load.

### Check if Xvfb is Running:
```bash
ps aux | grep Xvfb
```

### Restart with Optimized Settings:
```bash
# Kill existing
pkill Xvfb

# Start optimized Xvfb
Xvfb :99 -screen 0 1346x766x24 -ac +extension GLX +render -noreset &
```

### Make Permanent (systemd service):
```bash
sudo nano /etc/systemd/system/xvfb.service
```

```ini
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
```

```bash
sudo systemctl enable xvfb
sudo systemctl start xvfb
sudo systemctl status xvfb
```

---

## Issue #9: ❌ Low MAX_BROWSERS Config

### Create/Update .env file:
```bash
nano .env
```

```bash
# Server Config
DOMAIN=your-domain.com
PORT=3000
MAX_BROWSERS=100           # Increase from 50
BROWSER_IDLE_TIMEOUT=300000  # 5 minutes

# Chromium Path (VERIFY THIS!)
CHROMIUM_PATH=/usr/bin/chromium-browser

# API Security
API_KEY=your-secret-api-key-here

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_CREATE_MAX=100

# WebSocket Rate Limiting  
WSS_RATE_LIMIT_MAX_CONNECTIONS=100
WSS_RATE_LIMIT_MAX_MESSAGES=5000
```

---

## 🔧 COMPLETE FIX CHECKLIST

### 1. System Setup (Run Once)
```bash
# Update system limits
sudo nano /etc/security/limits.conf    # Add limits from Issue #4
sudo nano /etc/sysctl.conf             # Add sysctl from Issue #4
sudo sysctl -p

# Increase shared memory
sudo mount -o remount,size=8G /dev/shm
sudo nano /etc/fstab                   # Make permanent

# Install dependencies
sudo apt-get update
sudo apt-get install -y chromium-browser xvfb fonts-liberation \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcups2 \
  libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
  libwayland-client0 libxcomposite1 libxdamage1 libxfixes3 \
  libxkbcommon0 libxrandr2 xdg-utils

# Setup Xvfb service
sudo nano /etc/systemd/system/xvfb.service  # Copy from Issue #8
sudo systemctl enable xvfb
sudo systemctl start xvfb

# REBOOT
sudo reboot
```

### 2. Code Fixes (Apply to Your Project)

**A. Fix server.js - Listen on All Interfaces:**
```javascript
// Change from:
server.listen(port, '127.0.0.1', () => {

// To:
server.listen(port, '0.0.0.0', () => {
```

**B. Fix browserPool.js - Add Chrome Args & Port Range:**
See Issue #3 and Issue #7 above.

**C. Create .env file:**
See Issue #9 above.

### 3. Verify Setup
```bash
# Check limits
ulimit -n     # Should show 100000
ulimit -u     # Should show 50000

# Check shared memory
df -h /dev/shm  # Should show 8G

# Check Xvfb
ps aux | grep Xvfb

# Check Chromium path
which chromium-browser
ls -la /usr/bin/chromium*

# Check if port is accessible
netstat -tulpn | grep 3000
```

### 4. Test
```bash
# Start your server
cd /path/to/BrowserServer
npm start

# In another terminal, test locally
curl http://localhost:3000/health

# Test from external machine (use your server IP)
curl http://YOUR_SERVER_IP:3000/health
```

---

## 📊 Expected Performance

With these fixes, your 32 CPU / 128GB RAM server should handle:

- ✅ **100+ concurrent browsers** easily
- ✅ **Memory usage:** ~500MB per browser = 50GB for 100 browsers
- ✅ **CPU usage:** Distributed across 32 cores
- ✅ **Startup time:** <5 seconds per browser
- ✅ **Stability:** No OOM kills, no crashes

---

## 🔍 Debugging Commands

```bash
# Monitor memory
watch -n 2 free -h

# Monitor processes
watch -n 2 'ps aux | grep chromium | wc -l'

# Monitor Chrome processes details
ps aux | grep chromium

# Check OOM killer logs
dmesg | grep -i "killed process"
sudo journalctl | grep -i "out of memory"

# Monitor open files
lsof | wc -l
cat /proc/sys/fs/file-nr

# Monitor server logs
pm2 logs browser-server  # If using PM2
journalctl -u your-service -f  # If using systemd

# Test browser creation
curl -X POST http://localhost:3000/browsers \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"headful": false}'
```

---

## 🚨 Most Likely Root Causes (Priority Order)

1. **Wrong Chromium path** → Browsers never start
2. **Listening on 127.0.0.1 only** → Can't access from outside
3. **Missing --disable-dev-shm-usage** → OOM kills
4. **Missing --no-sandbox** → Permission denied
5. **Low ulimit** → "Too many open files" errors
6. **Small /dev/shm** → Chrome crashes

Apply fixes in this order for fastest results!
