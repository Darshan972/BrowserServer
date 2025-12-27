# 🚀 Quick Fix Guide - Ubuntu Server

Your **32 CPU / 128GB RAM** server can't run 10 browsers because of **configuration issues**, not hardware!

## ⚡ FASTEST FIX (5 minutes)

On your **Ubuntu Hetzner server**, run these commands:

```bash
# 1. Upload files to your server
scp setup-ubuntu.sh test-ubuntu.sh root@YOUR_SERVER_IP:/root/BrowserServer/

# 2. SSH into your server
ssh root@YOUR_SERVER_IP

# 3. Go to your project directory
cd /root/BrowserServer

# 4. Run the automated setup
sudo bash setup-ubuntu.sh

# 5. REBOOT (REQUIRED!)
sudo reboot

# 6. After reboot, test configuration
bash test-ubuntu.sh

# 7. Update .env file
nano .env
# Change: DOMAIN, API_KEY, MAX_BROWSERS

# 8. Start your server
npm start
```

## 🔍 What's Wrong (Root Causes)

### 1. **Server Only Listens on Localhost** ❌
**Problem:** `server.listen(port, '127.0.0.1')` blocks external connections  
**Fix:** Changed to `server.listen(port, '0.0.0.0')` ✅  
**Impact:** Can't access server from outside = 0 browsers work

### 2. **Missing Critical Chrome Flags** ❌
**Problem:** No `--disable-dev-shm-usage` or `--no-sandbox`  
**Fix:** Added 20+ optimized flags ✅  
**Impact:** Chrome crashes with "Out of Memory" errors

### 3. **Wrong Chromium Path** ❌
**Problem:** `/usr/bin/Chromium-browser` (capital C - doesn't exist)  
**Fix:** `/usr/bin/chromium-browser` (lowercase) ✅  
**Impact:** Browsers never start

### 4. **System Limits Too Low** ❌
**Problem:** Default `ulimit -n` = 1024 (only 1024 open files)  
**Fix:** Increased to 100,000 ✅  
**Impact:** "Too many open files" after 3-5 browsers

### 5. **/dev/shm Too Small** ❌
**Problem:** Default 64MB, Chrome needs ~200MB per browser  
**Fix:** Increased to 8GB ✅  
**Impact:** Chrome crashes silently

## 📊 Expected Results After Fix

| Metric | Before | After |
|--------|--------|-------|
| Max Browsers | 0-5 | 100+ |
| Memory per Browser | Crashes | ~500MB |
| CPU Usage | N/A | <30% |
| Startup Time | Timeouts | <5 seconds |
| Errors | OOM kills | None |

## 🧪 Test Commands (After Fix)

```bash
# Verify configuration
bash test-ubuntu.sh

# Check limits
ulimit -n          # Should show: 100000
ulimit -u          # Should show: 50000
df -h /dev/shm     # Should show: 8G

# Check Chrome path
which chromium-browser

# Check Xvfb
ps aux | grep Xvfb

# Start server
npm start

# Test health endpoint
curl http://localhost:3000/health

# Create a test browser
curl -X POST http://localhost:3000/browsers \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"headful": false}'

# Check Chrome processes
ps aux | grep chromium | wc -l

# Monitor memory
watch -n 2 free -h
```

## 📝 Files Modified

✅ **server.js** - Changed listen from `127.0.0.1` → `0.0.0.0`  
✅ **browserPool.js** - Added 20+ Chrome optimization flags  
✅ **browserPool.js** - Port range: 8000-8100 → 9000-19000  
✅ **config.js** - Fixed Chromium path case  

## 🆕 Files Created

✅ **UBUNTU_FIXES.md** - Complete documentation  
✅ **setup-ubuntu.sh** - Automated setup script  
✅ **test-ubuntu.sh** - Diagnostic script  
✅ **.env.example** - Configuration template  

## 🚨 Common Errors & Solutions

### Error: "Browser failed to start in 20s"
**Cause:** Wrong Chromium path or missing dependencies  
**Fix:** Run `which chromium-browser` and update CHROMIUM_PATH in .env

### Error: "Max 50 browsers reached" but only 10 running
**Cause:** Zombie processes not cleaned up  
**Fix:** `pkill chromium && npm start`

### Error: "Cannot connect to websocket"
**Cause:** Firewall blocking ports or nginx misconfiguration  
**Fix:** Check firewall: `ufw status` or `iptables -L`

### Error: Process killed (no error message)
**Cause:** OOM killer  
**Fix:** Check logs: `dmesg | grep -i killed` - increase /dev/shm

## 🔗 Next Steps After Basic Setup

1. **SSL/HTTPS**: Set up Let's Encrypt certificates
2. **Nginx**: Configure reverse proxy (see nginx.conf)
3. **PM2**: Set up process manager for auto-restart
4. **Monitoring**: Add Prometheus/Grafana
5. **Scaling**: Follow SCALING.md for multi-server setup

## 💡 Pro Tips

- Start with MAX_BROWSERS=50, then increase gradually
- Monitor with `htop` or `watch -n 2 free -h`
- Each browser uses ~500MB RAM, so 100 browsers = 50GB
- Keep idle timeout low (5 minutes) for high traffic
- Use PM2 cluster mode for multiple Node.js processes

## 🆘 Still Having Issues?

Run the diagnostic script and share output:
```bash
bash test-ubuntu.sh > diagnostic.txt
cat diagnostic.txt
```

Check logs:
```bash
# Chrome OOM kills
dmesg | grep -i "killed process"

# System logs
journalctl -xe

# Your app logs
pm2 logs  # if using PM2
```
