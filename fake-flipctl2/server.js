#!/usr/bin/env node
'use strict';

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var util = require('util');
var execSync = require('child_process').execSync;
var exec = require('child_process').exec;
var execAsync = util.promisify(exec);

// Async exec helper that swallows errors. Returns { stdout, stderr } on
// success, null on any failure (non-zero exit, timeout, missing binary).
// Endpoints aggregating several commands chain through this so a shell
// failure in one step doesn't fault the whole refresh, and — crucially —
// the Node loop never blocks on a subprocess: that's fatal for the
// touchpad SSE stream that lives in the same process.
function tryExec(cmd, opts) {
    return execAsync(cmd, opts || { encoding: 'utf8' }).then(
        function(r) { return r; },
        function()  { return null; }
    );
}

// Background refresher: invokes `fn` (returns Promise), waits for it to
// settle, sleeps `ms`, repeats. Errors are logged but never break the
// loop. Using setTimeout chains instead of setInterval guarantees no
// overlap when a refresh runs longer than its period.
function startRefreshLoop(name, fn, ms) {
    function tick() {
        Promise.resolve().then(fn).catch(function(e) {
            console.warn('[' + name + '] refresh error: ' + (e && e.message || e));
        }).then(function() {
            setTimeout(tick, ms);
        });
    }
    tick();
}

var PORT = 8899;
var BIND = '0.0.0.0';

// Regenerated on every process start. The browser polls /api/version
// and triggers location.reload() when this value changes, so the UI
// reloads itself after a variant switch without needing cog to restart.
var SERVER_ID = crypto.randomBytes(8).toString('hex');

// On Linux (Flipper), root is required for sysfs access
if (process.platform === 'linux' && process.getuid() !== 0) {
    console.error('Error: server must be run as root on Linux');
    process.exit(1);
}

var MIME = {
    '.html': 'text/html',
    '.css':  'text/css',
    '.js':   'application/javascript',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.json': 'application/json',
    '.wav':  'audio/wav'
};

var BASE = __dirname;

var PSU = '/sys/class/power_supply/bq28z610-0';
var QMI_DEV = '/dev/cdc-wdm0';

// ── Touchpad ABS_X / ABS_Y SSE stream ──────────────────────────────────
//
// Open /dev/input/event1 once at startup. The kernel emits 24-byte
// input_event structs (16-byte timeval + u16 type + u16 code + s32 value).
// Three integer fields per event at fixed offsets — no text, no spawn,
// no child process. On each EV_SYN/SYN_REPORT we flush the current
// "x,y,touching" triple to every SSE subscriber as one short line. With
// no subscribers we skip the write entirely, so idle cost is zero.
var TOUCHPAD_DEV = '/dev/input/event1';
var touchpadClients = new Set();
var tpX = 0, tpY = 0, tpTouching = false;

function startTouchpadStream() {
    var stream;
    try { stream = fs.createReadStream(TOUCHPAD_DEV); }
    catch (e) { console.warn('[touchpad] open failed: ' + e.message); return; }

    stream.on('data', function(chunk) {
        for (var off = 0; off + 24 <= chunk.length; off += 24) {
            var type = chunk.readUInt16LE(off + 16);
            var code = chunk.readUInt16LE(off + 18);
            var val  = chunk.readInt32LE (off + 20);
            if (type === 3) {                            // EV_ABS
                if      (code === 0) tpX = val;          // ABS_X
                else if (code === 1) tpY = val;          // ABS_Y
            } else if (type === 1 && code === 330) {     // EV_KEY / BTN_TOUCH
                tpTouching = (val === 1);
            } else if (type === 0 && code === 0 && touchpadClients.size) {
                // EV_SYN / SYN_REPORT — frame complete, push to subscribers.
                var line = 'data:' + tpX + ',' + tpY + ',' + (tpTouching ? 1 : 0) + '\n\n';
                touchpadClients.forEach(function(res) { res.write(line); });
            }
        }
    });
    stream.on('error', function(e) { console.warn('[touchpad] ' + e.message); });
    console.log('[touchpad] streaming ABS_X/ABS_Y from ' + TOUCHPAD_DEV);
}

// Bandwidth tracking: previous byte counters + timestamp
var bwPrev = { rx: 0, tx: 0, ts: 0, iface: null };

function readSysInt(p) {
    try { return parseInt(fs.readFileSync(p, 'utf8').trim(), 10); }
    catch (e) { return null; }
}

function getBandwidth(iface) {
    if (!iface) return { dlMbps: null, ulMbps: null };
    var rx = readSysInt('/sys/class/net/' + iface + '/statistics/rx_bytes');
    var tx = readSysInt('/sys/class/net/' + iface + '/statistics/tx_bytes');
    var now = Date.now();

    if (rx === null || tx === null) return { dlMbps: null, ulMbps: null };

    var result = { dlMbps: null, ulMbps: null };
    if (bwPrev.iface === iface && bwPrev.ts > 0) {
        var dtSec = (now - bwPrev.ts) / 1000;
        if (dtSec > 0.05) {
            result.dlMbps = +((rx - bwPrev.rx) * 8 / 1000000 / dtSec).toFixed(1);
            result.ulMbps = +((tx - bwPrev.tx) * 8 / 1000000 / dtSec).toFixed(1);
        }
    }
    bwPrev.rx = rx;
    bwPrev.tx = tx;
    bwPrev.ts = now;
    bwPrev.iface = iface;
    return result;
}

function deepGet(obj, keyPath) {
    var parts = keyPath.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return null;
        cur = cur[parts[i]];
    }
    return cur !== undefined && cur !== null ? cur : null;
}

function rxMatch(str, re) {
    var m = str.match(re);
    return m ? m[1] : null;
}

// Last-known modem snapshot. Refreshed asynchronously every second by
// refreshModem(); HTTP /api/modem returns this object directly without
// any shell-out, so modem info is never on the request path's hot loop.
var modemCache = { available: false };

async function refreshModem() {
    var result = { available: false };

    var mmRes = await tryExec('mmcli -m 0 -J 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
    if (!mmRes) { modemCache = result; return; }
    var mm;
    try { mm = JSON.parse(mmRes.stdout); }
    catch (e) { modemCache = result; return; }

    var modem = mm.modem || mm;
    result.available = true;

    result.model = deepGet(modem, 'generic.model') || deepGet(modem, 'hardware.model') || null;
    result.operator = deepGet(modem, '3gpp.operator-name') || null;
    result.operatorCode = deepGet(modem, '3gpp.operator-code') || null;
    result.state = deepGet(modem, 'generic.state') || null;

    var techs = deepGet(modem, 'generic.access-technologies') || [];
    if (typeof techs === 'string') techs = techs.split(',').map(function(s) { return s.trim(); });
    result.accessTech = techs;

    var sq = deepGet(modem, 'generic.signal-quality');
    if (sq && typeof sq === 'object') {
        result.signalQuality = parseInt(sq.value, 10) || null;
    } else if (sq) {
        result.signalQuality = parseInt(sq, 10) || null;
    } else {
        result.signalQuality = null;
    }

    result.ip4 = null;
    result.ip6 = null;
    result.iface = null;
    var bearers = deepGet(modem, 'generic.bearers') || [];
    if (bearers.length > 0) {
        var bPath = bearers[bearers.length - 1];
        var bNum = bPath.match(/(\d+)$/);
        if (bNum) {
            var bRes = await tryExec('mmcli -b ' + bNum[1] + ' -J 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
            if (bRes) {
                try {
                    var bearer = JSON.parse(bRes.stdout);
                    var b = bearer.bearer || bearer;
                    result.ip4 = deepGet(b, 'ipv4-config.address') || null;
                    result.ip6 = deepGet(b, 'ipv6-config.address') || null;
                    result.iface = deepGet(b, 'status.interface') || null;
                } catch (e) {}
            }
        }
    }

    var bw = getBandwidth(result.iface);
    result.dlMbps = bw.dlMbps;
    result.ulMbps = bw.ulMbps;

    var ssRes = await tryExec(
        'qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-serving-system 2>/dev/null',
        { encoding: 'utf8', timeout: 2000 });
    if (ssRes) {
        var ss = ssRes.stdout;
        result.cellId = rxMatch(ss, /3GPP cell ID:\s*'(\d+)'/);
        result.tac = rxMatch(ss, /LTE tracking area code:\s*'(\d+)'/);
        result.mcc = rxMatch(ss, /MCC:\s*'(\d+)'/);
        result.mnc = rxMatch(ss, /MNC:\s*'(\d+)'/);
    }

    var clRes = await tryExec(
        'qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-cell-location-info 2>/dev/null',
        { encoding: 'utf8', timeout: 2000 });
    if (clRes) {
        var cl = clRes.stdout;
        var earfcnMatch = cl.match(/EUTRA Absolute RF Channel Number:\s*'(\d+)'\s*\(([^)]+)\)/);
        if (earfcnMatch) {
            result.earfcn = earfcnMatch[1];
            result.band = earfcnMatch[2];
        }
        result.pci = rxMatch(cl, /Serving Cell ID:\s*'(\d+)'/);
    }

    var sigRes = await tryExec(
        'qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-signal-strength 2>/dev/null',
        { encoding: 'utf8', timeout: 2000 });
    if (sigRes) {
        var sig = sigRes.stdout;
        result.rsrp = rxMatch(sig, /RSRP:[\s\S]*?Network '[^']*':\s*'([^']+)'/);
        result.rsrq = rxMatch(sig, /RSRQ:[\s\S]*?Network '[^']*':\s*'([^']+)'/);
        result.sinr = rxMatch(sig, /SINR[^:]*:\s*'([^']+)'/);
    }

    modemCache = result;
}

function readInt(filePath) {
    try {
        return parseInt(fs.readFileSync(filePath, 'utf8').trim(), 10);
    } catch (e) {
        return null;
    }
}

function readStr(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').trim();
    } catch (e) {
        return null;
    }
}

// Find the thermal zone registered by the battery fuel-gauge driver
// (bq28z610-0 on FlipperOne). We scan every /sys/class/thermal/thermal_zoneN
// and match the `type` file against the PSU driver name — zone indices can
// vary between kernels, so matching by type is more robust than hard-coding
// a zone number. Returns { zone, type, tempC } or null.
function getBatteryTemp() {
    var base = '/sys/class/thermal';
    var entries;
    try { entries = fs.readdirSync(base); }
    catch (e) { return null; }

    // The PSU path ends with the driver instance (e.g. "bq28z610-0") and
    // that's exactly the string exposed in thermal_zone*/type.
    var psuName = PSU.split('/').pop();

    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (name.indexOf('thermal_zone') !== 0) continue;
        var type = readStr(base + '/' + name + '/type');
        if (!type) continue;
        // Prefer exact match on the PSU driver name; fall back to any
        // zone whose type starts with "bq" (battery gauge) if the rename
        // changes between board revisions.
        var isBattery = (type === psuName) || /^bq\d/i.test(type);
        if (!isBattery) continue;
        var milliC = readInt(base + '/' + name + '/temp');
        if (milliC === null) continue;
        return { zone: name, type: type, tempC: +(milliC / 1000).toFixed(1) };
    }
    return null;
}

// SoC package temperature. Scans /sys/class/thermal for the zone whose
// `type` is `package-thermal` (the Rockchip SoC package sensor on FlipperOne);
// falls back to any zone whose type contains "package". Zone indices can
// vary between kernels, so matching by type is the robust approach.
// Returns { zone, type, tempC } or null.
function getCpuTemp() {
    var base = '/sys/class/thermal';
    var entries;
    try { entries = fs.readdirSync(base); }
    catch (e) { return null; }

    var fallback = null;
    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (name.indexOf('thermal_zone') !== 0) continue;
        var type = readStr(base + '/' + name + '/type');
        if (!type) continue;
        var exact = (type === 'package-thermal');
        var fuzzy = /package/i.test(type);
        if (!exact && !fuzzy) continue;
        var milliC = readInt(base + '/' + name + '/temp');
        if (milliC === null) continue;
        var entry = { zone: name, type: type, tempC: +(milliC / 1000).toFixed(1) };
        if (exact) return entry;
        if (!fallback) fallback = entry;
    }
    return fallback;
}

// Battery power flow in watts. The bq28z610 gauge writes a smoothed
// average to `power_avg` in microwatts. Sign convention: negative values
// mean the pack is discharging (load draws from battery), positive means
// charging.
function getPowerUsage() {
    var uW = readInt(PSU + '/power_avg');
    if (uW === null) return null;
    return { watts: +(uW / 1000000).toFixed(2) };
}

function getPowerInfo() {
    var result = { available: false };
    if (!fs.existsSync(PSU)) return result;

    result.available = true;
    result.status = readStr(PSU + '/status');
    result.capacity = readInt(PSU + '/capacity');

    var v_uV = readInt(PSU + '/voltage_now');
    var i_uA = readInt(PSU + '/current_now');
    var p_uW = readInt(PSU + '/power_now');

    result.voltage = v_uV !== null ? +(v_uV / 1000000).toFixed(3) : null;
    result.current = i_uA !== null ? +(i_uA / 1000000).toFixed(3) : null;

    // Power: prefer power_now, fallback to V*I
    if (p_uW !== null) {
        result.power = +(p_uW / 1000000).toFixed(3);
    } else if (v_uV !== null && i_uA !== null) {
        result.power = +((v_uV * i_uA) / 1000000000000).toFixed(3);
    } else {
        result.power = null;
    }

    var chNow = readInt(PSU + '/charge_now');
    var chFull = readInt(PSU + '/charge_full');
    result.chargeNow = chNow !== null ? +(chNow / 1000000).toFixed(3) : null;
    result.chargeFull = chFull !== null ? +(chFull / 1000000).toFixed(3) : null;

    result.timeToEmpty = readInt(PSU + '/time_to_empty_now');
    result.timeToFull = readInt(PSU + '/time_to_full_now');
    result.temp = readInt(PSU + '/temp');

    return result;
}

var UPDATE_REPO = '/flipperone-testing';
var UPDATE_BRANCH = 'dev';

function getUpdateStatus() {
    var result = { available: false, currentCommit: null, commits: [], error: null };
    try {
        result.currentCommit = execSync('git -C ' + UPDATE_REPO + ' log --oneline -1', { encoding: 'utf8', timeout: 5000 }).trim();
    } catch (e) {
        result.error = 'Cannot read local repo';
        return result;
    }
    try {
        execSync('git -C ' + UPDATE_REPO + ' fetch origin ' + UPDATE_BRANCH + ' 2>&1', { encoding: 'utf8', timeout: 15000 });
    } catch (e) {
        result.error = 'No internet';
        return result;
    }
    try {
        var log = execSync('git -C ' + UPDATE_REPO + ' log --oneline HEAD..origin/' + UPDATE_BRANCH, { encoding: 'utf8', timeout: 5000 }).trim();
        if (log) {
            result.available = true;
            result.commits = log.split('\n');
        }
    } catch (e) {
        result.error = 'Cannot compare branches';
    }
    return result;
}

function logUpdate(msg) {
    var ts = new Date().toISOString();
    try { fs.appendFileSync('/tmp/fake-flipctl-update.log', ts + ' ' + msg + '\n'); } catch (e) {}
    console.log('[update] ' + msg);
}

function doUpdate() {
    var result = { success: false, error: null };
    logUpdate('Starting update');
    try {
        logUpdate('git reset --hard HEAD');
        var r1 = execSync('git -C ' + UPDATE_REPO + ' reset --hard HEAD 2>&1', { encoding: 'utf8', timeout: 5000 });
        logUpdate('reset: ' + r1.trim());
    } catch (e) {
        logUpdate('reset failed: ' + e.message);
        result.error = 'reset failed';
        return result;
    }
    try {
        logUpdate('git clean -fd');
        var r2 = execSync('git -C ' + UPDATE_REPO + ' clean -fd 2>&1', { encoding: 'utf8', timeout: 5000 });
        logUpdate('clean: ' + r2.trim());
    } catch (e) {
        logUpdate('clean failed: ' + e.message);
    }
    try {
        logUpdate('git pull origin ' + UPDATE_BRANCH);
        var r3 = execSync('git -C ' + UPDATE_REPO + ' pull origin ' + UPDATE_BRANCH + ' 2>&1', { encoding: 'utf8', timeout: 30000 });
        logUpdate('pull: ' + r3.trim());
        result.success = true;
    } catch (e) {
        var msg = (e.stderr || e.stdout || e.message || 'Unknown error').toString();
        var lines = msg.split('\n').filter(function(l) { return l.trim(); });
        result.error = (lines[0] || 'Unknown error').substring(0, 120);
        logUpdate('pull failed: ' + msg);
    }
    logUpdate('Done, success=' + result.success);
    return result;
}

var routingCache = [];

async function refreshRouting() {
    var routes = [];
    var r4 = await tryExec('ip -4 route show default 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
    if (r4) {
        var lines4 = r4.stdout.trim().split('\n');
        for (var i = 0; i < lines4.length; i++) {
            if (!lines4[i]) continue;
            var m4 = lines4[i].match(/default via (\S+) dev (\S+).*?metric (\d+)/);
            if (m4) routes.push({ family: 'IPv4', gateway: m4[1], dev: m4[2], metric: parseInt(m4[3], 10) });
            else {
                var m4b = lines4[i].match(/default via (\S+) dev (\S+)/);
                if (m4b) routes.push({ family: 'IPv4', gateway: m4b[1], dev: m4b[2], metric: null });
            }
        }
    }
    var r6 = await tryExec('ip -6 route show default 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
    if (r6) {
        var lines6 = r6.stdout.trim().split('\n');
        for (var j = 0; j < lines6.length; j++) {
            if (!lines6[j]) continue;
            var m6 = lines6[j].match(/default via (\S+) dev (\S+).*?metric (\d+)/);
            if (m6) routes.push({ family: 'IPv6', gateway: m6[1], dev: m6[2], metric: parseInt(m6[3], 10) });
            else {
                var m6b = lines6[j].match(/default via (\S+) dev (\S+)/);
                if (m6b) routes.push({ family: 'IPv6', gateway: m6b[1], dev: m6b[2], metric: null });
            }
        }
    }
    routingCache = routes;
}

// `flipusb0` is the USB-gadget Ethernet device created on builds
// that ship the cdc_ether/g_ether kernel module. NetworkManager
// usually treats it as `unmanaged`, so its IPs (typically a
// link-local 169.254.x.x set by a startup script) won't appear
// via `nmcli device show` — the fallback `ip -j addr show <iface>`
// pass below picks them up.
var ETH_IFACES = ['end0', 'end1', 'flipusb0'];

var ethernetCache = [];

async function refreshEthernet() {
    var ifaces = [];
    for (var i = 0; i < ETH_IFACES.length; i++) {
        var name = ETH_IFACES[i];
        if (!fs.existsSync('/sys/class/net/' + name)) continue;

        var info = { name: name, state: null, ip4: [], ip6: [], gateway4: null, gateway6: null, dns: [] };
        var nmRes = await tryExec('nmcli -t device show ' + name + ' 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        if (nmRes) {
            var lines = nmRes.stdout.split('\n');
            for (var j = 0; j < lines.length; j++) {
                var parts = lines[j].split(':');
                var key = parts[0];
                var val = parts.slice(1).join(':');
                if (key === 'GENERAL.STATE') info.state = val;
                else if (key.match(/^IP4\.ADDRESS/)) info.ip4.push(val);
                else if (key.match(/^IP6\.ADDRESS/)) info.ip6.push(val);
                else if (key === 'IP4.GATEWAY') info.gateway4 = val || null;
                else if (key === 'IP6.GATEWAY') info.gateway6 = val || null;
                else if (key.match(/^IP4\.DNS/)) info.dns.push(val);
            }
        } else {
            info.state = 'unavailable';
        }
        var carrier = readSysInt('/sys/class/net/' + name + '/carrier');
        if (carrier === 0) info.state = 'disconnected (no carrier)';

        info.speed = null;
        if (carrier !== 0) {
            var ethRes = await tryExec('ethtool ' + name + ' 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
            if (ethRes) {
                var speedMatch = ethRes.stdout.match(/^\s*Speed:\s*([^\s]+)/m);
                if (speedMatch && speedMatch[1] !== 'Unknown!' && speedMatch[1] !== 'Unknown') {
                    info.speed = speedMatch[1];
                }
            }
        }
        info.rxBytes = readSysInt('/sys/class/net/' + name + '/statistics/rx_bytes');
        info.txBytes = readSysInt('/sys/class/net/' + name + '/statistics/tx_bytes');

        if (info.ip4.length === 0 && carrier !== 0) {
            var ipRes = await tryExec('ip -j addr show ' + name + ' 2>/dev/null',
                { encoding: 'utf8', timeout: 1500 });
            if (ipRes) {
                try {
                    var ipdata = JSON.parse(ipRes.stdout);
                    if (Array.isArray(ipdata) && ipdata[0]
                            && Array.isArray(ipdata[0].addr_info)) {
                        var addrs = ipdata[0].addr_info;
                        for (var ki = 0; ki < addrs.length; ki++) {
                            var a = addrs[ki];
                            if (!a || !a.local) continue;
                            var cidr = a.local + '/' + a.prefixlen;
                            if (a.family === 'inet')       info.ip4.push(cidr);
                            else if (a.family === 'inet6') info.ip6.push(cidr);
                        }
                        if (info.ip4.length > 0
                            && (!info.state || info.state.indexOf('connected') === -1)) {
                            info.state = 'connected';
                        }
                    }
                } catch (e) {}
            }
        }

        info.ipv4Method = null;
        if (carrier !== 0) {
            var actRes = await tryExec('nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null',
                { encoding: 'utf8', timeout: 1500 });
            if (actRes) {
                var actLines = actRes.stdout.split('\n');
                var connName = null;
                for (var ai = 0; ai < actLines.length; ai++) {
                    var ln = actLines[ai];
                    if (!ln) continue;
                    var idx = -1;
                    for (var p = ln.length - 1; p >= 0; p--) {
                        if (ln.charAt(p) === ':' && (p === 0 || ln.charAt(p - 1) !== '\\')) { idx = p; break; }
                    }
                    if (idx === -1) continue;
                    var dev = ln.substring(idx + 1);
                    if (dev === name) {
                        connName = ln.substring(0, idx).replace(/\\:/g, ':');
                        break;
                    }
                }
                if (connName) {
                    var methodRes = await tryExec(
                        'nmcli -t -f ipv4.method connection show "' + connName.replace(/"/g, '\\"') + '" 2>/dev/null',
                        { encoding: 'utf8', timeout: 1500 });
                    if (methodRes) {
                        var mm = methodRes.stdout.match(/ipv4\.method:(.+)/);
                        if (mm) info.ipv4Method = mm[1].trim();
                    }
                }
            }
        }
        ifaces.push(info);
    }
    ethernetCache = ifaces;
}

var diskCache = { device: '/dev/mmcblk0p2', mounted: false };

async function refreshDisk() {
    var result = { device: '/dev/mmcblk0p2', mounted: false };
    var r = await tryExec('df -k /dev/mmcblk0p2 2>/dev/null', { encoding: 'utf8' });
    if (r) {
        var lines = r.stdout.trim().split('\n');
        if (lines.length >= 2) {
            var parts = lines[1].trim().split(/\s+/);
            var totalKB = parseInt(parts[1], 10);
            var usedKB = parseInt(parts[2], 10);
            result.mounted = true;
            result.totalGB = +(totalKB / 1048576).toFixed(1);
            result.usedGB = +(usedKB / 1048576).toFixed(1);
        }
    }
    diskCache = result;
}

var SOUND_DIR = '/flipperone-testing/sound/audio_files';
var DRIVER_SCRIPT = '/flipperone-testing/sound/audio-driver-restart.sh';
var audioChild = null;

function getSoundFiles() {
    var files = [];
    try {
        var entries = fs.readdirSync(SOUND_DIR);
        for (var i = 0; i < entries.length; i++) {
            if (/\.(wav|flac|ogg|aiff?|mp3|au|snd|caf|w64|wv|amr|voc|sph|xi)$/i.test(entries[i])) files.push(entries[i]);
        }
        files.sort();
    } catch (e) {}
    return files;
}

function playSoundFile(filename) {
    // Sanitize: only allow filenames, no path separators
    if (/[\/\\]/.test(filename)) return { success: false, error: 'Invalid filename' };
    var filePath = path.join(SOUND_DIR, filename);
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    // Kill any currently playing audio
    stopSound();

    var cmd = 'play ' + JSON.stringify(filePath);
    if (selectedAlsaDevice) {
        cmd = 'AUDIODEV=' + selectedAlsaDevice + ' ' + cmd;
    }

    audioChild = exec(cmd, { timeout: 30000 }, function(err) {
        audioChild = null;
    });

    return { success: true, file: filename };
}

function stopSound() {
    if (audioChild) {
        try { audioChild.kill(); } catch (e) {}
        audioChild = null;
    }
}

var selectedAlsaDevice = null; // e.g. "hw:3,0" — persists for this server session

function getAudioDevices() {
    var result = { devices: [], defaultDevice: selectedAlsaDevice };
    try {
        var out = execSync('aplay -l 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        var lines = out.split('\n');
        for (var i = 0; i < lines.length; i++) {
            // Match: card 3: NAU8822 [On-board Analog NAU8822], device 0: ...
            var m = lines[i].match(/^card (\d+): (\S+) \[([^\]]+)\], device (\d+): (.+)/);
            if (m) {
                var hwName = 'hw:' + m[1] + ',' + m[4];
                result.devices.push({
                    name: hwName,
                    cardName: m[2],
                    description: m[3],
                    device: m[4],
                    detail: m[5]
                });
            }
        }
    } catch (e) {}
    return result;
}

function setDefaultDevice(deviceName) {
    // Validate it's a real hw: device string
    if (!/^hw:\d+,\d+$/.test(deviceName)) {
        return { success: false, error: 'Invalid device name' };
    }
    selectedAlsaDevice = deviceName;
    return { success: true, device: deviceName };
}

// Find NAU8822 card number dynamically
function getNau8822Card() {
    try {
        var cards = fs.readFileSync('/proc/asound/cards', 'utf8');
        var m = cards.match(/^\s*(\d+)\s+\[NAU8822/m);
        return m ? m[1] : null;
    } catch (e) { return null; }
}

function getVolume() {
    var result = { speaker: null, headphone: null, speakerMuted: false, headphoneMuted: false };
    var card = getNau8822Card();
    if (!card) return result;
    try {
        var spk = execSync('amixer -c ' + card + ' get Speaker 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
        var ms = spk.match(/\[(\d+)%\]/);
        if (ms) result.speaker = parseInt(ms[1], 10);
        result.speakerMuted = /\[off\]/.test(spk);
    } catch (e) {}
    try {
        var hp = execSync('amixer -c ' + card + ' get Headphone 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
        var mh = hp.match(/\[(\d+)%\]/);
        if (mh) result.headphone = parseInt(mh[1], 10);
        result.headphoneMuted = /\[off\]/.test(hp);
    } catch (e) {}
    return result;
}

function setVolume(control, pct) {
    var card = getNau8822Card();
    if (!card) return { success: false, error: 'NAU8822 not found' };
    if (control !== 'Speaker' && control !== 'Headphone') return { success: false, error: 'Invalid control' };
    pct = Math.max(0, Math.min(100, parseInt(pct, 10)));
    try {
        execSync('amixer -c ' + card + ' set ' + control + ' ' + pct + '% 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
        return { success: true, volume: pct };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function restartAudioDriver() {
    try {
        var out = execSync(DRIVER_SCRIPT + ' 2>&1', { encoding: 'utf8', timeout: 15000 });
        return { success: true, output: out };
    } catch (e) {
        var output = (e.stdout || '') + (e.stderr || '');
        return { success: false, output: output || e.message };
    }
}

function readJsonBody(req, callback) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
        try { callback(null, JSON.parse(body)); }
        catch (e) { callback(e, null); }
    });
}

function serveStatic(req, res) {
    var urlPath = req.url.split('?')[0];
    if (urlPath === '/') urlPath = '/index.html';

    // Prevent directory traversal
    var filePath = path.join(BASE, path.normalize(urlPath));
    if (filePath.indexOf(BASE) !== 0) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    var ext = path.extname(filePath);
    var mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(filePath, function(err, data) {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

// Wi-Fi connection info.
//
// Previously parsed `nmcli dev wifi` (the scan list) and relied on the
// IN-USE `*` marker. That list is unstable — background rescans, roaming,
// and cache refreshes briefly drop the `*` row, which looked like
// disconnections in the UI.
//
// New approach: query the active connection state directly. `nmcli c show
// --active` reflects NetworkManager's state machine, not the scan list,
// so it doesn't flap during rescans. If an 802-11-wireless connection is
// activated, we're connected; then fetch signal via `iw dev link` which
// reads kernel-side link state (also not tied to scan cache).
var wifiCache = { connected: false, quality: 0, ssid: '', iface: '', ip4: [], ip6: [] };

async function refreshWifi() {
    var result = { connected: false, quality: 0, ssid: '', iface: '', ip4: [], ip6: [] };
    var actRes = await tryExec('nmcli -t -f NAME,TYPE,STATE c show --active',
        { encoding: 'utf8', timeout: 2000 });
    if (!actRes) { wifiCache = result; return; }

    var wifiName = null;
    var lines = actRes.stdout.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) continue;
        var parts = line
            .replace(/\\:/g, '\x01')
            .split(':')
            .map(function(p) { return p.replace(/\x01/g, ':'); });
        if (parts[1] === '802-11-wireless' && parts[2] === 'activated') {
            wifiName = parts[0] || '';
            break;
        }
    }
    if (!wifiName) { wifiCache = result; return; }

    var ssid = wifiName;
    var quality = 0;
    var iface = null;
    var ip4 = [];
    var ip6 = [];

    var devRes = await tryExec(
        'nmcli -t -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.CONNECTION d show',
        { encoding: 'utf8', timeout: 2000 });
    if (devRes) {
        var blocks = devRes.stdout.split(/\n(?=GENERAL\.DEVICE:)/);
        var escName = wifiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (var b = 0; b < blocks.length; b++) {
            if (/GENERAL\.TYPE:wifi/.test(blocks[b]) &&
                new RegExp('GENERAL\\.CONNECTION:' + escName).test(blocks[b])) {
                var m = blocks[b].match(/GENERAL\.DEVICE:([^\n]+)/);
                if (m) iface = m[1];
                break;
            }
        }
        if (iface) {
            var linkRes = await tryExec('iw dev ' + iface + ' link',
                { encoding: 'utf8', timeout: 1500 });
            if (linkRes) {
                var link = linkRes.stdout;
                var ssidM = link.match(/SSID:\s*(.+)/);
                if (ssidM) ssid = ssidM[1].trim();
                var sigM = link.match(/signal:\s*(-?\d+)\s*dBm/);
                if (sigM) {
                    var dbm = parseInt(sigM[1], 10);
                    quality = Math.max(0, Math.min(100, 2 * (dbm + 100)));
                }
            }
        }
    }

    if (iface) {
        var ipRes = await tryExec('nmcli -t device show ' + iface + ' 2>/dev/null',
            { encoding: 'utf8', timeout: 2000 });
        if (ipRes) {
            var ipLines = ipRes.stdout.split('\n');
            for (var li = 0; li < ipLines.length; li++) {
                var lp = ipLines[li].split(':');
                var key = lp[0];
                var val = lp.slice(1).join(':');
                if (key.match(/^IP4\.ADDRESS/))      ip4.push(val);
                else if (key.match(/^IP6\.ADDRESS/)) ip6.push(val);
            }
        }
    }

    if (quality === 0) {
        var scanRes = await tryExec('nmcli -t -f IN-USE,SSID,SIGNAL dev wifi',
            { encoding: 'utf8', timeout: 2000 });
        if (scanRes) {
            var sl = scanRes.stdout.split('\n');
            for (var j = 0; j < sl.length; j++) {
                if (!sl[j] || sl[j][0] !== '*') continue;
                var sp = sl[j].replace(/\\:/g, '\x01').split(':').map(
                    function(p) { return p.replace(/\x01/g, ':'); });
                var s = parseInt(sp[2], 10);
                if (!isNaN(s)) quality = Math.max(0, Math.min(100, s));
                if (sp[1]) ssid = sp[1];
                break;
            }
        }
    }

    wifiCache = {
        connected: true,
        quality: quality,
        ssid: ssid,
        iface: iface || '',
        ip4: ip4,
        ip6: ip6
    };
}

var airplaneCache = { enabled: false };

async function refreshAirplane() {
    var r = await tryExec('nmcli -t -f WIFI,WWAN radio', { encoding: 'utf8', timeout: 2000 });
    if (!r) { airplaneCache = { enabled: false }; return; }
    var line = r.stdout.split('\n').find(function(l) { return l; }) || '';
    var parts = line.split(':');
    var wifi = parts[0] || '';
    var wwan = parts[1] || '';
    airplaneCache = { enabled: wifi === 'disabled' && wwan === 'disabled' };
}

function setAirplaneMode(enabled, cb) {
    exec('nmcli radio all ' + (enabled ? 'off' : 'on'),
        { encoding: 'utf8', timeout: 3000 },
        function(err) {
            if (err) cb({ ok: false, error: String(err.message || err) });
            else cb({ ok: true });
        });
}

var server = http.createServer(function(req, res) {
    if (req.url === '/api/wifi') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wifiCache));
        return;
    }
    if (req.url === '/api/airplane' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(airplaneCache));
        return;
    }
    if (req.url === '/api/airplane' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            setAirplaneMode(!!(data && data.enabled), function(result) {
                // Optimistically refresh the cache so the next GET reflects
                // the new state without waiting for the 3 s background poll.
                refreshAirplane();
                res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(Object.assign({ enabled: !!(data && data.enabled) }, result)));
            });
        });
        return;
    }
    if (req.url === '/api/power') {
        var power = getPowerInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(power));
        return;
    }
    if (req.url === '/api/battery/temp') {
        var bt = getBatteryTemp();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bt || { tempC: null }));
        return;
    }
    if (req.url === '/api/cpu/temp') {
        var ct = getCpuTemp();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ct || { tempC: null }));
        return;
    }
    if (req.url === '/api/power/usage') {
        var pu = getPowerUsage();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pu || { watts: null }));
        return;
    }
    if (req.url === '/api/touchpad/xy') {
        // SSE messages are short (~15 B). With Nagle on the kernel
        // batches them up to ~40 ms — fatal for an interactive feed.
        req.socket.setNoDelay(true);
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();
        res.write('\n');
        touchpadClients.add(res);
        req.on('close', function() { touchpadClients.delete(res); });
        return;
    }
    if (req.url === '/api/modem') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modemCache));
        return;
    }
    if (req.url === '/api/update/check') {
        var update = getUpdateStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(update));
        return;
    }
    if (req.url === '/api/update/apply' && req.method === 'POST') {
        var upResult = doUpdate();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(upResult));
        if (upResult.success) {
            // Restart the node service only. The client's /api/version watcher
            // will detect the new SERVER_ID and reload the page inside the
            // already-running cog — no cog restart needed. daemon-reload in
            // case the pull updated the .service file on disk.
            var spawn = require('child_process').spawn;
            spawn('systemd-run', ['--collect', '--no-block', 'sh', '-c',
                'systemctl daemon-reload' +
                ' && systemctl restart fake-flipctl-node-server.service'], {
                detached: true,
                stdio: 'ignore'
            }).unref();
        }
        return;
    }
    if (req.url === '/api/routing') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(routingCache));
        return;
    }
    if (req.url === '/api/ethernet') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(ethernetCache));
        return;
    }
    if (req.url === '/api/disk') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(diskCache));
        return;
    }
    if (req.url === '/api/sound/files') {
        var soundFiles = getSoundFiles();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: soundFiles }));
        return;
    }
    if (req.url === '/api/sound/play' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.file) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var playResult = playSoundFile(data.file);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(playResult));
        });
        return;
    }
    if (req.url === '/api/sound/stop' && req.method === 'POST') {
        stopSound();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    if (req.url === '/api/sound/devices') {
        var audioDevs = getAudioDevices();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(audioDevs));
        return;
    }
    if (req.url === '/api/sound/device' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.device) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var setResult = setDefaultDevice(data.device);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(setResult));
        });
        return;
    }
    if (req.url === '/api/sound/volume' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || data.volume === undefined || !data.control) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var volResult = setVolume(data.control, data.volume);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(volResult));
        });
        return;
    }
    if (req.url === '/api/sound/volume' && req.method === 'GET') {
        var vol = getVolume();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(vol));
        return;
    }
    if (req.url === '/api/sound/restart-driver' && req.method === 'POST') {
        var driverResult = restartAudioDriver();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(driverResult));
        return;
    }
    if (req.url === '/api/hostname' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ hostname: os.hostname() }));
        return;
    }
    if (req.url === '/api/version' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ id: SERVER_ID }));
        return;
    }
    if (req.url === '/api/switch/flipctl' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        // Swap the variant symlink and restart ourselves. Client-side JS is
        // polling /api/version and will reload the page when SERVER_ID changes
        // — so no cog restart is needed. systemd-run keeps the pipeline in
        // a transient unit outside our own cgroup, so it survives the restart.
        // daemon-reload picks up any .service file change that landed via a
        // prior OTA pull — otherwise systemd warns "changed on disk" and may
        // keep running the old unit.
        var cmd = 'ln -sfn /flipperone-testing/fake-flipctl /flipperone-testing/active-flipctl' +
                  ' && systemctl daemon-reload' +
                  ' && systemctl restart fake-flipctl-node-server.service';
        var spawn = require('child_process').spawn;
        spawn('systemd-run', ['--collect', '--no-block', 'sh', '-c', cmd], {
            detached: true,
            stdio: 'ignore'
        }).unref();
        return;
    }
    serveStatic(req, res);
});

server.listen(PORT, BIND, function() {
    console.log('flipctl server listening on http://' + BIND + ':' + PORT);
    if (process.platform === 'linux') {
        try { startTouchpadStream(); }
        catch (e) { console.warn('[touchpad] startup failed: ' + e.message); }

        // Background refreshers keep per-endpoint snapshots fresh without
        // ever blocking the main loop. Periods match the previous client
        // poll rates so perceived freshness is unchanged. HTTP handlers
        // just read the cached objects.
        startRefreshLoop('modem',    refreshModem,    1000);
        startRefreshLoop('wifi',     refreshWifi,     2000);
        startRefreshLoop('ethernet', refreshEthernet, 2000);
        startRefreshLoop('routing',  refreshRouting,  5000);
        startRefreshLoop('airplane', refreshAirplane, 3000);
        startRefreshLoop('disk',     refreshDisk,    30000);
    }
});
