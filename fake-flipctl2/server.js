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

// ── Network LEDs ─────────────────────────────────────────────────
// "Network LEDs" — the four RGB LEDs along the top of the Flipper
// One that surface networking state: wifi, eth0, eth1, link.
// Backed by sysfs at /sys/class/leds/. Sysfs entries are
// root-owned so every write goes through
// `sudo sh -c 'echo X > /path'` — passwordless sudo is configured
// for the `user` account on these devices, so the shell call
// returns without prompting.
//
// Usage model:
//   • ledState['name'] holds the LAST-applied target so we only
//     rewrite when something actually changes (cuts unnecessary
//     sysfs writes during the 1 Hz tick).
//   • applyLedTarget(name, target) writes only the diff,
//     respecting the kernel's ordering rules (set trigger=none
//     before manual color/brightness, set color BEFORE trigger
//     when activating one).
//   • applyLedsFromState() runs every second + after every wifi
//     state change, mapping (wifiCache + ethernetCache + the
//     transient `ledWifiConnecting` flag) → LED states.
var ledState = {};
function _shellQuote(s) { return JSON.stringify(String(s)); }
function _writeLedFile(led, file, value) {
    var path = '/sys/class/leds/' + led + '/' + file;
    var inner = 'echo ' + value + ' > ' + path;
    var cmd = 'sudo sh -c ' + _shellQuote(inner);
    exec(cmd, { encoding: 'utf8', timeout: 2000 }, function() {});
}
// Apply a target {trigger, multi_intensity?, brightness?,
// delay_on?, delay_off?} to `led`. Diffs against the last
// applied target so untouched fields skip the write.
function applyLedTarget(led, target) {
    var prev = ledState[led] || {};
    var t    = target.trigger || 'none';
    if (t === 'none') {
        // Manual control — release any active trigger first so
        // subsequent multi_intensity / brightness writes stick.
        if (prev.trigger !== 'none') {
            _writeLedFile(led, 'trigger', 'none');
        }
        if (target.multi_intensity != null
            && target.multi_intensity !== prev.multi_intensity) {
            _writeLedFile(led, 'multi_intensity', target.multi_intensity);
        }
        if (target.brightness != null
            && target.brightness !== prev.brightness) {
            _writeLedFile(led, 'brightness', target.brightness);
        }
    } else {
        // Trigger-driven (e.g. timer for breathing). Set
        // multi_intensity FIRST so the trigger has a colour
        // when it activates, then switch trigger, then any
        // trigger-specific knobs.
        if (target.multi_intensity != null
            && target.multi_intensity !== prev.multi_intensity) {
            _writeLedFile(led, 'multi_intensity', target.multi_intensity);
        }
        if (t !== prev.trigger) {
            _writeLedFile(led, 'trigger', t);
        }
        if (target.delay_on != null
            && target.delay_on !== prev.delay_on) {
            _writeLedFile(led, 'delay_on', target.delay_on);
        }
        if (target.delay_off != null
            && target.delay_off !== prev.delay_off) {
            _writeLedFile(led, 'delay_off', target.delay_off);
        }
    }
    ledState[led] = target;
}
function ledOff(led) {
    applyLedTarget(led, { trigger: 'none', brightness: '0' });
}
// Transient flag — set true at the start of POST /api/wifi/connect,
// flipped back to false when the call resolves. Drives the wifi
// LED's "breathing blue" pattern via the timer trigger.
var ledWifiConnecting = false;
// Link LED state — driven entirely by POST /api/led/link from
// other applications. Kept here so applyLedsFromState() doesn't
// stomp it during periodic ticks.
var ledLinkOn = false;
// Manual override — when true, applyLedsFromState() bows out so
// the testing scene's direct /api/led/set writes stick. Toggled
// via /api/led/manual.
var ledManualMode = false;
function applyLedsFromState() {
    if (ledManualMode) return;
    // ── Wi-Fi ──
    // Status colour is full cyan (0,255,255) — picked in the
    // Network LEDs testing scene and confirmed against the
    // physical hardware.
    var wifiLed = 'flipper-one:rgb:wifi';
    if (ledWifiConnecting) {
        // Breathing cyan while a connect is in flight. Timer
        // trigger gives a slow blink (500/500); not a true
        // sine "breath" but cheap and recognisable.
        applyLedTarget(wifiLed, {
            trigger:         'timer',
            multi_intensity: '0 255 255',
            delay_on:        '500',
            delay_off:       '500'
        });
    } else if (wifiCache && wifiCache.connected) {
        applyLedTarget(wifiLed, {
            trigger:         'none',
            multi_intensity: '0 255 255',
            brightness:      '255'
        });
    } else {
        ledOff(wifiLed);
    }
    // ── Ethernet ── interface name → LED slot:
    //   end0 → flipper-one:rgb:eth0
    //   end1 → flipper-one:rgb:eth1
    var ethMap = { 'end0': 'flipper-one:rgb:eth0',
                   'end1': 'flipper-one:rgb:eth1' };
    for (var ei = 0; ei < (ethernetCache || []).length; ei++) {
        var iface = ethernetCache[ei];
        var led   = ethMap[iface.name];
        if (!led) continue;
        // "Connected" = state string contains the word
        // (matches both nmcli's cleaned output and our
        // ip-address fallback).
        var isUp = !!(iface.state
                      && iface.state.indexOf('connected') !== -1
                      && iface.state.indexOf('disconnected') === -1);
        if (isUp) {
            // Status colour for both ETH LEDs is a lime green
            // (120,255,0) — picked in the Network LEDs testing
            // scene against the physical hardware.
            applyLedTarget(led, {
                trigger:         'none',
                multi_intensity: '120 255 0',
                brightness:      '255'
            });
        } else {
            ledOff(led);
        }
    }
    // Always ensure unmapped eth slot is off (e.g. eth1 LED
    // when only end0 is wired).
    for (var k in ethMap) {
        var found = false;
        for (var ej = 0; ej < (ethernetCache || []).length; ej++) {
            if (ethernetCache[ej].name === k) { found = true; break; }
        }
        if (!found) ledOff(ethMap[k]);
    }
    // ── Link ──  Driven by /api/led/link; this branch just
    // re-asserts the flag every tick so nothing else can drift
    // it (e.g. the kernel default coming back after a reboot).
    var linkLed = 'flipper-one:rgb:link';
    if (ledLinkOn) {
        applyLedTarget(linkLed, {
            trigger:         'none',
            multi_intensity: '0 0 255',
            brightness:      '255'
        });
    } else {
        ledOff(linkLed);
    }
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

// Extra sound entries that live outside SOUND_DIR — the device
// has its stock list under /flipperone-testing/sound/audio_files
// but we also want to expose project-bundled assets (e.g. the
// Walkie Talkie loop) in the same Play sound picker. Keys are the
// display filenames the picker shows; values are entry objects
// with `path` (absolute path on disk) and optional `effects`
// (sox effect string appended to the play command — used here to
// reverse the on-disk reversed file so the picker plays it
// forwards while leaving the asset itself reversed for whatever
// else consumes it). Entries whose path doesn't resolve at read
// time are silently skipped so nothing breaks if the asset is
// missing.
var EXTRA_SOUND_FILES = {
    // Do not modify the on-disk file — playback applies the sox
    // `reverse` effect to flip the stream at play time, leaving
    // the bytes untouched. Format matches spk_mono.wav (PCM
    // s16le, 48000 Hz, mono).
    '415_audio.wav': {
        path:    path.join(BASE, 'assets/apps/walkie_talkie/415_audio.wav'),
        effects: 'reverse'
    }
};

function getSoundFiles() {
    var files = [];
    try {
        var entries = fs.readdirSync(SOUND_DIR);
        for (var i = 0; i < entries.length; i++) {
            if (/\.(wav|flac|ogg|aiff?|mp3|au|snd|caf|w64|wv|amr|voc|sph|xi)$/i.test(entries[i])) files.push(entries[i]);
        }
    } catch (e) {}
    // Append project-bundled extras when their backing file
    // actually exists. Skip names that already appeared in the
    // device listing so we don't end up with duplicates.
    Object.keys(EXTRA_SOUND_FILES).forEach(function(name) {
        if (files.indexOf(name) !== -1) return;
        try {
            if (fs.existsSync(EXTRA_SOUND_FILES[name].path)) files.push(name);
        } catch (e) {}
    });
    files.sort();
    return files;
}

function playSoundFile(filename) {
    // Sanitize: only allow filenames, no path separators
    if (/[\/\\]/.test(filename)) return { success: false, error: 'Invalid filename' };
    // Extras take precedence — if the picked name is in our
    // override map, point sox at the bundled asset instead of
    // SOUND_DIR. Falls through to the device path otherwise.
    var extra    = EXTRA_SOUND_FILES[filename];
    var filePath = (extra && fs.existsSync(extra.path))
        ? extra.path
        : path.join(SOUND_DIR, filename);
    if (!fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    // Kill any currently playing audio
    stopSound();

    // `channels 2` forces a stereo output stream. The NAU8822's
    // SAI is wired stereo at the I2S level — opening hw:N,0 in
    // mono mode drains samples ~4× too fast (chipmunk pitch and
    // tempo). Asking sox to up-mix to two channels keeps the
    // codec in its native frame format; a no-op on already-stereo
    // input.
    var cmd = 'play ' + JSON.stringify(filePath) + ' channels 2';
    // Append per-entry sox effects (e.g. `reverse`) after the
    // baseline `channels 2` so they apply to the resampled stream.
    if (extra && extra.effects) {
        cmd += ' ' + extra.effects;
    }
    if (selectedAlsaDevice) {
        cmd = 'AUDIODEV=' + selectedAlsaDevice + ' ' + cmd;
    }

    audioChild = exec(cmd, { timeout: 30000 }, function(err) {
        audioChild = null;
    });

    return { success: true, file: filename };
}

function stopSound() {
    // Break the walkie-talkie respawn loop, if one is running.
    // The looping spawner only re-fires while `walkieActive` is
    // true, so flipping it here ensures any in-flight SIGKILL
    // doesn't immediately get followed by a fresh sox process.
    walkieActive = false;
    if (audioChild) {
        // SIGKILL, not SIGTERM — we want the ALSA device free
        // before the next caller (typically playRadioStream)
        // tries to open it. SIGTERM lets mpg123 do graceful
        // shutdown, which leaves the device busy for tens of
        // ms; the next mpg123 hits "Device or resource busy"
        // and exits, so the old stream keeps playing.
        try { audioChild.kill('SIGKILL'); } catch (e) {}
        audioChild = null;
    }
}

// ── Walkie Talkie audio loop ─────────────────────────────────────
// The Walkie Talkie scene wants 415_audio.wav playing on repeat
// for as long as the user is in the app. Playback applies the
// sox `reverse` effect — same trick the Sound > Play sound
// picker uses for the same file.
//
// Loops by respawning sox each time the previous child exits,
// guarded by `walkieActive` so an external stop (e.g. user picks
// another file in Play sound, or the scene's exit hook fires)
// breaks the cycle. Shares the global `audioChild` slot so the
// existing one-thing-at-a-time invariant the rest of the audio
// stack relies on still holds.
var walkieActive      = false;
var WALKIE_AUDIO_PATH = path.join(BASE, 'assets/apps/walkie_talkie/415_audio.wav');

function spawnWalkieOnce() {
    if (!walkieActive) return;
    if (!fs.existsSync(WALKIE_AUDIO_PATH)) {
        walkieActive = false;
        return;
    }
    // spawn (not exec) so SIGKILL hits sox directly instead of
    // the wrapping shell — with exec, killing the shell leaves
    // sox orphaned and it plays its 17.9 s iteration through to
    // completion before the loop actually goes silent. spawn
    // also makes the argv unambiguous (no shell-quoting).
    var spawn = require('child_process').spawn;
    var args  = [WALKIE_AUDIO_PATH, 'channels', '2', 'reverse'];
    var envCopy = Object.assign({}, process.env);
    if (selectedAlsaDevice) envCopy.AUDIODEV = selectedAlsaDevice;
    var child = spawn('play', args, { env: envCopy, stdio: 'ignore' });
    function onLeave() {
        // Identity-guard: only null the global if we're still the
        // tracked child. Avoids stomping on a successor that some
        // other producer (Play sound, radio) installed in the
        // meantime.
        if (audioChild === child) audioChild = null;
        if (walkieActive) {
            // Brief gap so ALSA can release the device before the
            // next sox attempts to open it — without this, the
            // next spawn frequently hits "Device or resource busy"
            // and exits immediately, which would make the loop
            // race itself into a tight respawn storm.
            setTimeout(spawnWalkieOnce, 80);
        }
    }
    child.on('exit',  onLeave);
    child.on('error', onLeave);
    audioChild = child;
}

function startWalkieLoop() {
    if (walkieActive) return { success: true, already: true };
    if (!fs.existsSync(WALKIE_AUDIO_PATH)) {
        return { success: false, error: 'Walkie audio not found' };
    }
    // Free the codec first — any other producer (Play sound, a
    // radio stream) yields immediately. `stopSound()` flips
    // walkieActive off, so we re-arm it AFTER.
    stopSound();
    walkieActive = true;
    spawnWalkieOnce();
    return { success: true };
}

function stopWalkieLoop() {
    if (!walkieActive) return { success: true, already: true };
    // stopSound() resets walkieActive to false and kills the
    // current child; the exit handler then sees walkieActive
    // false and skips the respawn.
    stopSound();
    return { success: true };
}

// ── Microphone level monitor ─────────────────────────────────────
// Spawns arecord against hw:1,0 in S16_LE stereo 48 kHz, reads the
// raw PCM stream off stdout, and tracks the peak amplitude per
// channel as integer percentages 0..100. Clients poll
// /api/mic/level for the latest values to drive on-screen meters.
//
// arecord writes ~192 KB/s; we only ever inspect the chunks that
// arrive (no accumulation), so memory and CPU stay bounded. A
// trailing odd byte at the end of a chunk is dropped — the next
// chunk's leading byte will pair up naturally.
var micChild         = null;
var micLeft          = 0;
var micRight         = 0;
// SSE subscribers receiving live level pushes. Populated by the
// /api/mic/level/stream handler; emptied as connections close.
// `_lastNotifyAt` rate-limits broadcasts to ~20 Hz even if
// arecord chunks arrive faster, so the network and the renderer
// stay calm.
var micSubscribers   = [];
var micLastNotifyAt  = 0;
var MIC_NOTIFY_MIN_MS = 50;

function notifyMicSubscribers() {
    if (!micSubscribers.length) return;
    var now = Date.now();
    if (now - micLastNotifyAt < MIC_NOTIFY_MIN_MS) return;
    micLastNotifyAt = now;
    var payload = 'data: ' + JSON.stringify({ left: micLeft, right: micRight }) + '\n\n';
    // Iterate in reverse so a write-error splice doesn't skip a
    // neighbouring subscriber.
    for (var i = micSubscribers.length - 1; i >= 0; i--) {
        try { micSubscribers[i].write(payload); }
        catch (e) { micSubscribers.splice(i, 1); }
    }
}

// Lowest-CPU peak walker for the live meter:
//
//  1. `--period-size=2048` asks ALSA for ~43-ms periods so
//     stdout 'data' fires ~23×/sec instead of the default
//     ~200×/sec. Fewer event-loop wake-ups beats clever inner
//     loops every time.
//  2. The MIC_COMPUTE_MIN_MS throttle is a safety net in case
//     the device ignores the period hint and gives us small
//     chunks anyway — we short-circuit fast and skip the
//     peak walk.
//  3. Inside the walk we stride by MIC_DECIMATE_STRIDE frames
//     (32 bytes per step at 8× decimation). Peaks at audio
//     frequencies are sustained across many samples, so 1-in-8
//     reads chase the same envelope at a fraction of the JS
//     loop cost.
var MIC_COMPUTE_MIN_MS  = 45;
var MIC_DECIMATE_STRIDE = 32;   // bytes per inner-loop step = 8 stereo frames
var micLastComputeAt    = 0;

function startMicLevelMonitor() {
    if (micChild) return { success: true, already: true };
    var spawn = require('child_process').spawn;
    try {
        micChild = spawn('arecord', [
            '-D', 'hw:1,0',
            '-f', 'S16_LE',
            '-r', '48000',
            '-c', '2',
            '--period-size=2048'
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
        micChild = null;
        return { success: false, error: String(e.message || e) };
    }

    micChild.stdout.on('data', function(chunk) {
        // Coarse throttle so a chatty device can't make us walk
        // chunks more often than we need to. The peak we
        // sample is at most 45 ms stale — invisible at meter
        // refresh rates.
        var now = Date.now();
        if (now - micLastComputeAt < MIC_COMPUTE_MIN_MS) return;
        micLastComputeAt = now;
        // Each interleaved stereo frame is 4 bytes: L low, L high,
        // R low, R high. Stride by MIC_DECIMATE_STRIDE bytes so
        // we only inspect 1-in-N frames; with N=8 this is ~60
        // reads per period at 2048 frames, plenty for a peak
        // meter while keeping the loop nearly free.
        var len = chunk.length - (chunk.length % 4);
        var pL  = 0, pR = 0;
        for (var i = 0; i + 3 < len; i += MIC_DECIMATE_STRIDE) {
            var sL = chunk.readInt16LE(i);
            var sR = chunk.readInt16LE(i + 2);
            if (sL < 0) sL = -sL;
            if (sR < 0) sR = -sR;
            if (sL > pL) pL = sL;
            if (sR > pR) pR = sR;
        }
        // 32767 is the max int16. Round to integer percent so the
        // JSON stays compact and the meter pixel math is clean.
        micLeft  = Math.round(pL * 100 / 32767);
        micRight = Math.round(pR * 100 / 32767);
        notifyMicSubscribers();
    });
    var onLeave = function() {
        if (micChild) micChild = null;
        micLeft = 0; micRight = 0;
    };
    micChild.on('exit',  onLeave);
    micChild.on('error', onLeave);
    return { success: true };
}

function stopMicLevelMonitor() {
    if (!micChild) return { success: true, already: true };
    try { micChild.kill('SIGKILL'); } catch (e) {}
    micChild = null;
    micLeft  = 0;
    micRight = 0;
    return { success: true };
}

// ── Internet radio streaming ─────────────────────────────────────
// mpg123 streams MP3/Shoutcast/Icecast directly over HTTP, so the
// radio scene can hand us a URL and we hand it straight to a
// child process. Reuses the same `audioChild` slot as the
// file-playback path — only one thing plays at a time, and the
// existing `stopSound()` machinery cleans up either case
// uniformly.
//
// `spawn` (not exec/shell) so the URL goes in as its own argv —
// no shell metacharacters in the user-supplied string ever reach
// /bin/sh. URL scheme is also gated to http(s) on the way in.
function playRadioStream(url) {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return { success: false, error: 'Invalid URL' };
    }
    var spawn = require('child_process').spawn;

    function doSpawn() {
        var args = ['-q'];
        // Route to the same ALSA device the rest of the audio
        // stack is using when the user has explicitly picked
        // one — but wrap a raw `hw:` form in `plughw:` so ALSA's
        // plug layer handles any sample-rate / format mismatch.
        // mpg123 outputs the MP3's native rate (44.1 kHz for
        // pop stations), which the HDMI card on this SoC
        // rejects through `hw:` even though the rate is inside
        // its [32000–48000] range — plughw resamples on the
        // fly and "Speaker", "Headphone", and "HDMI" all work
        // off the same code path.
        if (selectedAlsaDevice) {
            var dev = selectedAlsaDevice;
            if (/^hw:/.test(dev)) dev = 'plug' + dev;
            args.push('-a', dev);
        }
        args.push(url);
        var child = spawn('mpg123', args, { stdio: 'ignore' });
        // Identity-guard the global reference: only null it
        // out if we still ARE the active child. Without this,
        // a stale predecessor's exit event (which races with
        // the next playRadioStream call) overwrites the new
        // process's reference and the radio orphans.
        child.on('exit',  function() { if (audioChild === child) audioChild = null; });
        child.on('error', function() { if (audioChild === child) audioChild = null; });
        audioChild = child;
    }

    var oldChild = audioChild;
    audioChild = null;
    if (oldChild) {
        // Drop the old process's exit/error listeners so they
        // can't fire later and stomp on `audioChild` after
        // the new mpg123 has been assigned to it. Then SIGKILL
        // and wait for the kernel to actually reap the
        // process before spawning — that's the only way to
        // guarantee the ALSA device is free.
        oldChild.removeAllListeners('exit');
        oldChild.removeAllListeners('error');
        oldChild.once('exit',  doSpawn);
        oldChild.once('error', doSpawn);
        try { oldChild.kill('SIGKILL'); }
        catch (e) { doSpawn(); }
    } else {
        doSpawn();
    }
    return { success: true, url: url };
}

// ── Voice recorder ───────────────────────────────────────────────
// Captures the on-board NAU8822 codec to 16 kHz mono S16_LE WAV
// files via `sox`. arecord was tried first but its WAV header
// patching is broken on this build (placeholder sizes survive
// SIGINT/SIGTERM, files report ~18 hours long; mid-buffer stops
// also doubled the recorded duration). sox handles SIGINT
// cleanly + writes a valid header; the plug layer
// (`plughw:N,0`) transparently resamples the codec's native
// 48 kHz down to 16 kHz inside ALSA.
//
// `recordChild` and `recordState` are nulled together in the
// child's exit listener so a crash mid-recording can't desync
// them — every observer (status endpoint, the next start) sees
// "not recording" once the OS has actually torn the process down.
var RECORDINGS_DIR = '/flipperone-testing/sound/recordings';
var recordChild    = null;            // sox ChildProcess while recording
var recordState    = null;            // { file, startedAt: ms } while recording
// Peak amplitude over the most recent sox output chunk,
// normalised to 0..1. Updated synchronously by the sox-stdout
// data handler in `startRecording()` (no polling); reset to 0
// between recordings. Streamed to clients via the
// `/api/record/level` SSE endpoint.
var recordLevel    = 0;
try { fs.mkdirSync(RECORDINGS_DIR, { recursive: true }); } catch (e) {}

// ── Real-time level meter ──
// We pipe sox's RAW PCM stdout through Node — Node writes the
// WAV file AND computes the peak per chunk in the same pass.
// File-tail polling (the previous approach) was hostage to
// sox's stdio buffering: a recording that played back fine
// could still leave the on-disk size unchanged for hundreds of
// ms at a time, freezing the meter. Reading from sox.stdout
// gets us samples within tens of ms of capture and decouples
// the meter cadence from the file's flush schedule entirely.
//
// recordWavWriter holds the active fs.createWriteStream so the
// data handler can append to it; recordWavBytes tracks the
// total audio bytes written so we can patch the WAV header
// sizes on stop. Both are nulled together with recordChild.
var recordWavWriter = null;
var recordWavBytes  = 0;

function buildWavHeader(dataBytes, sampleRate, channels, bitsPerSample) {
    var byteRate   = sampleRate * channels * bitsPerSample / 8;
    var blockAlign = channels * bitsPerSample / 8;
    var buf = Buffer.alloc(44);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataBytes, 4);          // ChunkSize
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);                     // Subchunk1Size (PCM)
    buf.writeUInt16LE(1, 20);                      // AudioFormat = PCM
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bitsPerSample, 34);
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataBytes, 40);              // Subchunk2Size
    return buf;
}

// Patch the RIFF + data chunk size fields in a WAV file that
// was written with placeholder zeros. Called once on
// recording-stop, after the writer has fully drained.
function patchWavHeader(filePath, dataBytes) {
    try {
        var fd = fs.openSync(filePath, 'r+');
        var b  = Buffer.alloc(4);
        b.writeUInt32LE(36 + dataBytes, 0);
        fs.writeSync(fd, b, 0, 4, 4);              // RIFF ChunkSize
        b.writeUInt32LE(dataBytes, 0);
        fs.writeSync(fd, b, 0, 4, 40);             // data Subchunk2Size
        fs.closeSync(fd);
    } catch (e) { /* file may have been unlinked */ }
}

// Update `recordLevel` from a freshly-read S16LE chunk. Peak
// over the chunk → normalised to 0..1.
function updateLevelFromChunk(chunk) {
    var peak = 0;
    for (var i = 0; i + 1 < chunk.length; i += 2) {
        var s = chunk.readInt16LE(i);
        if (s < 0) s = -s;
        if (s > peak) peak = s;
    }
    recordLevel = peak / 32768;
    if (recordLevel > 1) recordLevel = 1;
}

// Reset the live level. Called from sox's `exit` / `error`
// handlers via `finalize()` so the meter snaps back to 0 the
// instant a recording ends — without this the last frame's
// peak would linger until something else updated it.
function stopLevelPoll() {
    recordLevel = 0;
}

function buildRecordingFilename() {
    // rec-YYYYMMDD-HHMMSS.wav — sortable, unique-per-second.
    // Local time so the filename matches what the user sees on
    // the device clock (the recordings list also uses local).
    var d   = new Date();
    var pad = function(n) { return n < 10 ? '0' + n : String(n); };
    return 'rec-'
         + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate())
         + '-'
         + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
         + '.wav';
}

function getRecordings() {
    var files = [];
    try {
        var entries = fs.readdirSync(RECORDINGS_DIR);
        for (var i = 0; i < entries.length; i++) {
            if (!/\.wav$/i.test(entries[i])) continue;
            try {
                var st = fs.statSync(path.join(RECORDINGS_DIR, entries[i]));
                files.push({
                    name:  entries[i],
                    size:  st.size,
                    mtime: st.mtimeMs
                });
            } catch (e) { /* skip unreadable */ }
        }
        // Newest first — list view always lands on most-recent.
        files.sort(function(a, b) { return b.mtime - a.mtime; });
    } catch (e) {}
    return files;
}

// Pump the NAU8822's mic / capture chain to maximum-ish gain
// via amixer. Different driver builds expose different control
// names, so we fire off every plausible one and ignore failures
// — the controls that don't exist throw and the ones that do
// land. Hardware gain has a much cleaner SNR than the post-hoc
// software gain in sox's effect chain, so we lean on it first.
function bumpRecordingMicGain(card) {
    if (!card) return;
    var attempts = [
        // Mic preamp boost — cheapest gain in the chain.
        ['Mic Boost',     '3'],
        ['Mic Boost',     '20dB'],
        // PGA / capture volume.
        ['Mic',           '100%'],
        ['Mic',           '63'],
        ['Capture',       '100%'],
        ['Capture',       '63'],
        ['Input PGA',     '100%'],
        ['Left Input PGA','100%'],
        ['Right Input PGA','100%'],
        // Some builds split the boost into a switch.
        ['Mic Boost',     'on'],
        ['Capture',       'on']
    ];
    for (var i = 0; i < attempts.length; i++) {
        var ctrl = attempts[i][0];
        var val  = attempts[i][1];
        try {
            execSync('amixer -c ' + card + ' set ' + JSON.stringify(ctrl)
                   + ' ' + JSON.stringify(val) + ' 2>/dev/null',
                   { encoding: 'utf8', timeout: 1500 });
        } catch (e) { /* control absent — try the next */ }
    }
}

function startRecording() {
    if (recordChild) {
        return { success: false, error: 'Already recording' };
    }
    var card = getNau8822Card();
    if (!card) {
        return { success: false, error: 'NAU8822 not found' };
    }
    // Codec contention guard — if something is playing back
    // through the same codec, kill it before opening capture.
    // No inverse on the playback side; full-duplex hasn't been
    // exercised on this build so the safer bet is one-at-a-time.
    stopSound();

    var filename = buildRecordingFilename();
    var filePath = path.join(RECORDINGS_DIR, filename);
    // Bump the hardware mic / capture gain BEFORE we open the
    // capture stream. NAU8822 expose a couple of common
    // controls; we try each defensively (errors swallowed)
    // because the exact set varies by ALSA version. This is
    // the cleanest dB the chain has — boosting in hardware
    // gives a much better SNR than amplifying a quiet sample
    // in software.
    bumpRecordingMicGain(card);

    var device   = 'hw:' + card + ',0';
    // sox writes RAW S16LE samples to stdout; we read them
    // here, write them to the WAV file (with our own header),
    // and update the level meter in the same pass. This keeps
    // the meter responsive — sox's file-write buffering used
    // to leave the file's tail stale for hundreds of ms at a
    // time, freezing the meter even though playback was fine.
    //
    // Capture rate matches the NAU8822's native 48 kHz: the
    // codec only opens at 48 k on hw:, and asking the plug
    // layer to resample down to 16 k introduced audible
    // artifacts + cut everything above 8 kHz. 48 k mono S16LE
    // ≈ 96 KB/s on disk — heavier than the old 32 KB/s but
    // still a couple of GB per day max, well within the eMMC
    // budget for voice memos.
    //
    // Effects chain (in order):
    //   highpass 80   — rolls off sub-bass rumble + DC drift
    //                   that just amplify into noise on boost.
    //   gain N        — software make-up gain on top of the
    //                   amixer hardware bumps above. Smaller
    //                   than before since the hardware does
    //                   the heavy lifting now.
    var RECORD_GAIN_DB = 6;
    var args = ['-q', '-t', 'alsa', device,
                '-r', '48000', '-c', '1', '-b', '16',
                '-t', 'raw', '-e', 'signed-integer', '-L', '-',
                'highpass', '80',
                'gain', String(RECORD_GAIN_DB)];
    var spawn = require('child_process').spawn;
    var fileStream = null;
    try {
        // Open the WAV file with placeholder header. We patch
        // the RIFF + data sizes on stop. 48 kHz / mono / 16-bit
        // matches the sox arg block above — keep these in
        // sync if either side changes.
        fileStream = fs.createWriteStream(filePath);
        fileStream.write(buildWavHeader(0, 48000, 1, 16));
    } catch (e) {
        return { success: false, error: String(e.message || e) };
    }
    try {
        recordChild = spawn('sox', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        try { fileStream.end(); } catch (e2) {}
        recordChild = null;
        return { success: false, error: String(e.message || e) };
    }
    recordWavWriter = fileStream;
    recordWavBytes  = 0;
    recordState     = { file: filename, startedAt: Date.now() };

    recordChild.stdout.on('data', function(chunk) {
        try {
            if (recordWavWriter) recordWavWriter.write(chunk);
        } catch (e) { /* writer closed mid-flight */ }
        recordWavBytes += chunk.length;
        // Compute the peak right here — no polling, no file
        // I/O, the chunk is fresh from sox's pipe buffer.
        updateLevelFromChunk(chunk);
    });

    var finalized = false;
    function finalize() {
        if (finalized) return;
        finalized = true;
        var path0 = filePath;
        var bytes0 = recordWavBytes;
        if (recordWavWriter) {
            // End the stream, then patch the header sizes once
            // the OS has flushed.
            try {
                recordWavWriter.end(function() {
                    patchWavHeader(path0, bytes0);
                });
            } catch (e) {
                patchWavHeader(path0, bytes0);
            }
        }
        recordChild     = null;
        recordState     = null;
        recordWavWriter = null;
        recordWavBytes  = 0;
        stopLevelPoll();
    }
    recordChild.on('exit',  finalize);
    recordChild.on('error', finalize);
    return { success: true, file: filename };
}

function stopRecording() {
    if (!recordChild) {
        // Idempotent — caller can `stop` blindly without
        // checking state first (the unload path uses sendBeacon
        // which has no response, so the "is it actually
        // running?" check happens here).
        return { success: true, recording: false };
    }
    var file = recordState ? recordState.file : null;
    try {
        // SIGINT lets sox flush its WAV header cleanly. SIGTERM
        // also works but SIGINT is the documented "stop and
        // finalize" signal for the tool.
        recordChild.kill('SIGINT');
    } catch (e) { /* already gone */ }
    return { success: true, recording: false, file: file };
}

function deleteRecording(filename) {
    if (typeof filename !== 'string') {
        return { success: false, error: 'Missing filename' };
    }
    if (/[\/\\]/.test(filename) || !/\.wav$/i.test(filename)) {
        return { success: false, error: 'Invalid filename' };
    }
    var filePath = path.join(RECORDINGS_DIR, filename);
    try {
        fs.unlinkSync(filePath);
        return { success: true };
    } catch (e) {
        return { success: false, error: String(e.message || e) };
    }
}

function playRecording(filename) {
    // Mirror playSoundFile but sourced from RECORDINGS_DIR. We
    // share the global audioChild so /api/sound/play and
    // /api/record/play can't end up dueling over the codec —
    // whichever fires last wins, and stopSound() cleanly kills
    // the predecessor.
    if (typeof filename !== 'string' || /[\/\\]/.test(filename)) {
        return { success: false, error: 'Invalid filename' };
    }
    var filePath = path.join(RECORDINGS_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File not found' };
    }
    stopSound();
    // See playSoundFile() for the `channels 2` rationale — the
    // NAU8822's I2S frame is stereo, mono playback drains 4×
    // too fast and pitches up to chipmunk.
    var cmd = 'play ' + JSON.stringify(filePath) + ' channels 2';
    if (selectedAlsaDevice) cmd = 'AUDIODEV=' + selectedAlsaDevice + ' ' + cmd;
    audioChild = exec(cmd, { timeout: 60000 }, function() {
        audioChild = null;
    });
    return { success: true, file: filename };
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

// ── High-level audio outputs ─────────────────────────────────────
// The radio app's "Audio device" picker thinks in terms of where
// the user wants the sound to come out (Speaker / Headphone / HDMI
// / DisplayPort), not which hw:N,0 device is involved. Speaker
// and Headphone share the same NAU8822 card — the split happens
// in the codec mixer (Speaker Switch / Headphones Switch +
// per-channel Playback Switches), which has no jack detection
// on this board, so the user picks explicitly and we mute the
// non-active path.
//
// Loopback (snd_aloop) is intentionally absent: it has no
// physical output and listening through it gives silence.
//
// `selectedOutputId` is best-effort state — it's only read when
// the radio app refreshes its picker and reset whenever the
// user explicitly picks an output. The Sound app's lower-level
// AudioDevicesScene still uses /api/sound/device directly and
// is unaffected.
var selectedOutputId = 'speaker';

function getSoundOutputs() {
    var result = { outputs: [], current: selectedOutputId };
    // Fixed mapping by card description. aplay -l's free-form
    // strings ("HDMI", "DP0", "On-board Analog NAU8822", …) are
    // stable on this device tree, so a description match is
    // enough to route each card to its high-level identity.
    var cards = {};
    try {
        var out = execSync('aplay -l 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        var lines = out.split('\n');
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/^card (\d+): (\S+) \[([^\]]+)\], device (\d+):/);
            if (m) cards[m[3]] = 'hw:' + m[1] + ',' + m[4];
        }
    } catch (e) {}
    if (cards['On-board Analog NAU8822']) {
        result.outputs.push({ id: 'speaker',   label: 'Speaker',   device: cards['On-board Analog NAU8822'] });
        result.outputs.push({ id: 'headphone', label: 'Headphone', device: cards['On-board Analog NAU8822'] });
    }
    if (cards['HDMI']) result.outputs.push({ id: 'hdmi', label: 'HDMI', device: cards['HDMI'] });
    if (cards['DP0'])  result.outputs.push({ id: 'dp',   label: 'DisplayPort', device: cards['DP0'] });

    // Lazy default. Until the user picks something explicitly,
    // selectedAlsaDevice is null — which makes mpg123 fall
    // through to ALSA's `default` device. On this build that's
    // Loopback (card 0), which has no physical output, so the
    // first /api/radio/play silently writes into a virtual sink.
    // Apply the current selectedOutputId here so the picker's
    // displayed value and the actual codec routing line up
    // before the user touches anything.
    if (!selectedAlsaDevice && result.outputs.length) {
        var def = null;
        for (var i = 0; i < result.outputs.length; i++) {
            if (result.outputs[i].id === selectedOutputId) {
                def = result.outputs[i]; break;
            }
        }
        if (!def) def = result.outputs[0];
        // Direct apply — must NOT call setSoundOutput here
        // because that re-enters getSoundOutputs() and the
        // HTTP request never completes (infinite recursion).
        _applyOutputState(def);
        result.current = def.id;
    }
    return result;
}

// Apply an output's device + codec mixer state without re-
// querying the output list. Split out from setSoundOutput so
// getSoundOutputs() can use it during lazy default-init
// without recursing back through setSoundOutput → getSoundOutputs.
//
// Codec mixer is only meaningful when the chosen card is the
// NAU8822: for HDMI / DP playback the mute state can't reach
// those cards. For Speaker / Headphone we toggle the simple-
// mixer playback switches that gate the DAC routes (`Speaker`
// and `Headphone` simple-control names — joined stereo
// p-switches over the per-channel Playback Switch numids the
// codec exposes). The mono `Headphones` amp-enable switch is
// set to on in both cases so headphone audio is never blocked
// by a stale amp-disable from a prior path.
function _applyOutputState(match) {
    selectedAlsaDevice = match.device;
    selectedOutputId   = match.id;
    var card = getNau8822Card();
    if (card && (match.id === 'speaker' || match.id === 'headphone')) {
        var spkOn = (match.id === 'speaker')   ? 'on' : 'off';
        var hpOn  = (match.id === 'headphone') ? 'on' : 'off';
        var cmds = [
            "amixer -c " + card + " set Speaker "    + spkOn,
            "amixer -c " + card + " set Headphone "  + hpOn,
            "amixer -c " + card + " set Headphones on"
        ];
        for (var ci = 0; ci < cmds.length; ci++) {
            try { execSync(cmds[ci] + ' 2>/dev/null', { timeout: 2000 }); }
            catch (e) { /* tolerate per-control failures */ }
        }
    }
}

function setSoundOutput(id) {
    var outs = getSoundOutputs().outputs;
    var match = null;
    for (var i = 0; i < outs.length; i++) if (outs[i].id === id) match = outs[i];
    if (!match) return { success: false, error: 'Unknown output' };
    _applyOutputState(match);
    return { success: true, id: id, device: match.device };
}

function setVolume(control, pct) {
    var card = getNau8822Card();
    if (!card) return { success: false, error: 'NAU8822 not found' };
    if (control !== 'Speaker' && control !== 'Headphone') return { success: false, error: 'Invalid control' };
    pct = Math.max(0, Math.min(100, parseInt(pct, 10)));
    try {
        // Chain `mute` / `unmute` onto the same amixer call so
        // 0 % genuinely silences the channel (some codec builds
        // still leak a small audible signal at 0 % volume), and
        // anything > 0 actively un-mutes — handles the case
        // where the user nudged volume up after a previous 0 %
        // muted the channel without dragging the unmute state
        // along for the ride.
        var muteArg = (pct === 0) ? 'mute' : 'unmute';
        execSync('amixer -c ' + card + ' set ' + control + ' '
                 + pct + '% ' + muteArg + ' 2>/dev/null',
                 { encoding: 'utf8', timeout: 2000 });
        return { success: true, volume: pct, muted: pct === 0 };
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

// ── /api/wifi/scan ──────────────────────────────────────────────
// Visible-networks list. `nmcli device wifi list` returns whatever
// scan results NetworkManager already has cached; we don't trigger
// a fresh `nmcli dev wifi rescan` here because that takes ~2-3 s
// and the polling cadence is enough to keep the list reasonably
// fresh on its own. Output is parsed into a deduplicated list of
// { ssid, signal (0-100), security } objects, sorted by signal.
// Hidden networks (empty SSID) and duplicate SSIDs (multiple BSSIDs
// for the same network) are collapsed.
// `ready` flips to true after the FIRST successful refresh that
// either has results OR follows a completed nmcli rescan.
// Subsequent failures keep the most recent successful list intact
// — the client distinguishes "scan in progress" (ready=false) from
// "scan finished, nothing visible" (ready=true, networks=[]) and
// shows a spinner only in the former case.
var wifiScanCache = { ready: false, networks: [] };
// Timestamp of the first successful `nmcli dev wifi rescan`. Until
// it's set we treat an empty list as "scan still in progress" and
// hold `ready` at false — otherwise the client would prematurely
// flip from spinner to "No networks" while NetworkManager is
// still warming up its scan cache.
var wifiRescanCompletedAt = 0;
// Server start time, used for a hard fallback: even if every
// rescan fails (e.g. no wifi adapter), we don't keep the spinner
// on forever — after this grace period an empty list is accepted
// as the genuine state.
var wifiScanStartedAt = Date.now();
var WIFI_SCAN_GRACE_MS = 30000;

async function triggerWifiRescan() {
    // Fire-and-await the rescan; nmcli blocks until the kernel-
    // initiated scan returns or times out. A 6 s ceiling protects
    // against driver hangs without forcing the loop to wait too
    // long between attempts.
    var r = await tryExec('nmcli dev wifi rescan',
        { encoding: 'utf8', timeout: 6000 });
    if (r && wifiRescanCompletedAt === 0) {
        wifiRescanCompletedAt = Date.now();
    }
}

async function refreshWifiScan() {
    var r = await tryExec(
        'nmcli -t -f SSID,SIGNAL,SECURITY device wifi list',
        { encoding: 'utf8', timeout: 3000 });
    // On failure, keep the previous cache as-is — clients keep
    // showing the most recent results rather than reverting to
    // "loading" mid-session.
    if (!r) return;
    var lines = r.stdout.split('\n');
    var byName = {};
    var nets = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line) continue;
        // nmcli escapes ':' inside fields as '\:' — temporarily
        // substitute to a sentinel byte so split(':') doesn't
        // shred SSIDs containing colons, then restore.
        var parts = line.replace(/\\:/g, '\x01').split(':').map(
            function(p) { return p.replace(/\x01/g, ':'); });
        var ssid     = parts[0];
        var signal   = parseInt(parts[1], 10);
        var security = parts[2] || '';
        if (!ssid) continue;
        if (isNaN(signal)) signal = 0;
        if (byName[ssid] !== undefined) {
            // Same SSID seen on a stronger BSSID — promote it.
            if (signal > byName[ssid].signal) {
                byName[ssid].signal   = signal;
                byName[ssid].security = security;
            }
            continue;
        }
        var net = { ssid: ssid, signal: signal, security: security };
        byName[ssid] = net;
        nets.push(net);
    }
    nets.sort(function(a, b) { return b.signal - a.signal; });
    // Gate the `ready` flag so the client doesn't prematurely flip
    // from spinner to "No networks":
    //   - Empty list + no rescan completed yet + still in startup
    //     grace window → keep ready=false (spinner stays).
    //   - Otherwise (non-empty, OR a rescan finished, OR grace
    //     window elapsed) → ready=true.
    var inGrace = (Date.now() - wifiScanStartedAt) < WIFI_SCAN_GRACE_MS;
    var rescanDone = wifiRescanCompletedAt !== 0;
    if (nets.length === 0 && !rescanDone && inGrace) return;
    wifiScanCache = { ready: true, networks: nets };
}

// ── /api/wifi/power ─────────────────────────────────────────────
// Wi-Fi radio on/off, mirroring `nmcli radio wifi` state. POST to
// `/api/wifi/power` with `{ enabled: true|false }` to flip it.
// Optimistically writes the cache before the nmcli call returns
// so the client can poll back the new state immediately; the
// 3-second refresh loop reconciles if the actual state differs.
var wifiPowerCache = { enabled: true };

async function refreshWifiPower() {
    var r = await tryExec('nmcli -t -f WIFI radio',
        { encoding: 'utf8', timeout: 2000 });
    if (!r) return;   // keep last value on failure
    var line = r.stdout.split('\n').find(function(l) { return l; }) || '';
    wifiPowerCache = { enabled: line.trim() === 'enabled' };
}

function setWifiPower(enabled, cb) {
    exec('nmcli radio wifi ' + (enabled ? 'on' : 'off'),
        { encoding: 'utf8', timeout: 3000 },
        function(err) {
            if (err) cb({ ok: false, error: String(err.message || err) });
            else cb({ ok: true });
        });
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
    if (req.url === '/api/wifi/scan') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wifiScanCache));
        return;
    }
    if (req.url === '/api/wifi/power' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wifiPowerCache));
        return;
    }
    if (req.url === '/api/wifi/power' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            var enabled = !!(data && data.enabled);
            // Optimistic write so the next GET reflects the
            // request immediately even before nmcli returns; the
            // 3-second refresh loop reconciles if the actual
            // radio state differs.
            wifiPowerCache = { enabled: enabled };
            setWifiPower(enabled, function(result) {
                refreshWifiPower();
                res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(Object.assign({ enabled: enabled }, result)));
            });
        });
        return;
    }
    if (req.url === '/api/wifi/disconnect' && req.method === 'POST') {
        // Disconnect from a Wi-Fi network without deleting the
        // saved profile. Body: { name }. Maps to
        // `nmcli connection down <name>`. Profile sticks around
        // for a future reconnect; only the active link drops.
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.name) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing name' }));
                return;
            }
            var nameQ = JSON.stringify(String(data.name));
            exec('nmcli connection down ' + nameQ,
                { encoding: 'utf8', timeout: 10000 },
                function(execErr, stdout, stderr) {
                    if (execErr) {
                        var msg = String(stderr || execErr.message || execErr).trim();
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: msg }));
                        return;
                    }
                    refreshWifi();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                });
        });
        return;
    }
    if (req.url === '/api/wifi/connect' && req.method === 'POST') {
        // Join a Wi-Fi network. Body: { ssid, password }.
        // Password may be empty for open networks. Internally we
        // call `nmcli device wifi connect <ssid> [password <pwd>]`,
        // which CREATES a connection profile if none exists for
        // that SSID and brings the link up. On success, refresh
        // the wifi/scan caches so the next client poll already
        // reflects the new state without a 2 s lag.
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.ssid) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing ssid' }));
                return;
            }
            var ssid = String(data.ssid);
            var pwd  = String(data.password || '');
            var ssidQ = JSON.stringify(ssid);
            // Build the nmcli invocation. Quoting via
            // JSON.stringify gets us proper shell-safe escaping
            // for SSIDs / passphrases that contain spaces or
            // shell-special characters.
            var cmd = 'nmcli device wifi connect ' + ssidQ;
            if (pwd) cmd += ' password ' + JSON.stringify(pwd);
            // Flip the wifi LED to "breathing blue" while the
            // connect runs. Cleared in every exit path so a
            // failed / timed-out attempt doesn't leave the LED
            // pulsing forever.
            ledWifiConnecting = true;
            applyLedsFromState();
            exec(cmd,
                { encoding: 'utf8', timeout: 30000 },
                function(execErr, stdout, stderr) {
                    ledWifiConnecting = false;
                    if (execErr) {
                        // nmcli writes the user-facing reason to
                        // stderr ("Secrets were required, but not
                        // provided", "No network with SSID '…'
                        // found", etc.). Pass it through verbatim
                        // so the client can surface it.
                        var msg = String(stderr || execErr.message || execErr).trim();
                        applyLedsFromState();
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: false, error: msg }));
                        return;
                    }
                    refreshWifi().then(function() { applyLedsFromState(); });
                    refreshWifiScan();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, output: String(stdout || '').trim() }));
                });
        });
        return;
    }
    if (req.url === '/api/wifi/forget' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.name) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Missing name' }));
                return;
            }
            // Quote the connection name so SSIDs containing spaces
            // / colons survive the shell. JSON.stringify gives us
            // a properly-escaped double-quoted form.
            var nameQ = JSON.stringify(String(data.name));
            exec('nmcli connection delete ' + nameQ,
                { encoding: 'utf8', timeout: 5000 },
                function(execErr) {
                    if (execErr) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            ok: false,
                            error: String(execErr.message || execErr)
                        }));
                    } else {
                        // Refresh the wifi caches so the active
                        // connection / scan list update on the
                        // next GET.
                        refreshWifi();
                        refreshWifiScan();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ok: true }));
                    }
                });
        });
        return;
    }
    if (req.url.indexOf('/api/wifi/connection') === 0 && req.method === 'GET') {
        // Read full settings for a Wi-Fi profile. Two modes:
        //   • No `name=` param → return the currently-active
        //     connection (back-compat with the old contract).
        //   • `name=<encoded>` → return THAT specific saved
        //     profile, regardless of whether it's active. Lets a
        //     single client component render verbose detail for
        //     both the live network and any saved one.
        // `secrets=1` adds the WPA passphrase via
        // `nmcli --show-secrets`. Server runs as root so the
        // lookup just works.
        var qs = req.url.indexOf('?') >= 0 ? req.url.substring(req.url.indexOf('?') + 1) : '';
        var withSecrets = qs.indexOf('secrets=1') >= 0;
        // Tiny query-string parser — pulls `name=<value>` out of
        // the qs (URL-decoded). Other params untouched.
        var qName = '';
        var pairs = qs.split('&');
        for (var qi = 0; qi < pairs.length; qi++) {
            var eq = pairs[qi].indexOf('=');
            if (eq < 0) continue;
            var k = pairs[qi].substring(0, eq);
            var v = pairs[qi].substring(eq + 1);
            if (k === 'name') {
                try { qName = decodeURIComponent(v.replace(/\+/g, ' ')); }
                catch (e) { qName = v; }
            }
        }
        var connName = qName || wifiCache.ssid;
        if (!connName) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ connected: false }));
            return;
        }
        var nameQ = JSON.stringify(String(connName));
        var cmd = 'nmcli ' + (withSecrets ? '--show-secrets ' : '')
            + '-t connection show ' + nameQ;
        exec(cmd, { encoding: 'utf8', timeout: 3000 }, function(execErr, stdout) {
            if (execErr) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(execErr.message || execErr) }));
                return;
            }
            // Parse field-per-line output. Same colon-escape
            // trick the other nmcli parsers use.
            var fields = {};
            var lines = stdout.split('\n');
            for (var i = 0; i < lines.length; i++) {
                var ln = lines[i];
                if (!ln) continue;
                var idx = ln.indexOf(':');
                if (idx < 0) continue;
                var k = ln.substring(0, idx);
                var v = ln.substring(idx + 1).replace(/\\:/g, ':');
                fields[k] = v;
            }
            function pickAddrs(prefix) {
                var addrs = [];
                for (var key in fields) {
                    if (key.indexOf(prefix) === 0) addrs.push(fields[key]);
                }
                return addrs;
            }
            var details = {
                connected: true,
                ssid:        connName,
                autoconnect: (fields['connection.autoconnect'] || '').toLowerCase() === 'yes',
                ipv4: {
                    method:    fields['ipv4.method']    || '',
                    gateway:   fields['ipv4.gateway']   || '',
                    dns:       fields['ipv4.dns']       || '',
                    addresses: pickAddrs('IP4.ADDRESS')
                },
                ipv6: {
                    method:    fields['ipv6.method']    || '',
                    gateway:   fields['ipv6.gateway']   || '',
                    dns:       fields['ipv6.dns']       || '',
                    addresses: pickAddrs('IP6.ADDRESS')
                }
            };
            if (withSecrets && fields['802-11-wireless-security.psk']) {
                details.password = fields['802-11-wireless-security.psk'];
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(details));
        });
        return;
    }
    if (req.url === '/api/wifi/saved' && req.method === 'GET') {
        // Return every saved Wi-Fi connection profile NetworkManager
        // knows about — i.e. networks the device has ever connected
        // to. Each entry: { name, ssid, security, autoconnect,
        // lastConnected }.
        //
        // First pass: list all 802-11-wireless connections via the
        // terse `nmcli -t -f NAME,TYPE connection show` form.
        // Second pass: per-profile `connection show <name>` to pull
        // the richer fields. We do these sequentially in a small
        // loop rather than firing N parallel nmcli calls — saved
        // networks tend to be a handful, and serial keeps load low.
        exec('nmcli -t -f NAME,TYPE connection show',
             { encoding: 'utf8', timeout: 4000 },
             function(listErr, listOut) {
            if (listErr) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ networks: [] }));
                return;
            }
            var lines = (listOut || '').split('\n');
            var names = [];
            for (var li = 0; li < lines.length; li++) {
                var ln = lines[li];
                if (!ln) continue;
                // Terse output is `NAME:TYPE`. NAME may itself
                // contain literal colons escaped as `\:`. Walk
                // back from the trailing TYPE field using the
                // last unescaped `:`.
                var idx = -1;
                for (var ci = ln.length - 1; ci >= 0; ci--) {
                    if (ln.charAt(ci) === ':' && (ci === 0 || ln.charAt(ci - 1) !== '\\')) {
                        idx = ci; break;
                    }
                }
                if (idx < 0) continue;
                var nm = ln.substring(0, idx).replace(/\\:/g, ':');
                var tp = ln.substring(idx + 1);
                if (tp !== '802-11-wireless') continue;
                // Skip internal device-managed profiles. These
                // are connection entries the firmware creates
                // for its own networking (e.g. the Flipper One's
                // 2.4 GHz / 5 GHz router profiles created during
                // factory provisioning) — not user-saved
                // networks. Easy to extend with more patterns if
                // new internal naming conventions show up.
                if (/^wifi-router/i.test(nm)) continue;
                if (/^flipper-/i.test(nm))    continue;
                names.push(nm);
            }
            // Resolve detail fields one connection at a time. As
            // each resolves, decrement `pending`; when the last
            // one lands, write the response.
            var results = [];
            var pending = names.length;
            if (pending === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ networks: [] }));
                return;
            }
            names.forEach(function(name, i) {
                var quoted = JSON.stringify(String(name));
                exec('nmcli -t connection show ' + quoted,
                     { encoding: 'utf8', timeout: 3000 },
                     function(dErr, dOut) {
                    var fields = {};
                    if (!dErr && dOut) {
                        var dlines = dOut.split('\n');
                        for (var j = 0; j < dlines.length; j++) {
                            var dl = dlines[j];
                            if (!dl) continue;
                            var di = dl.indexOf(':');
                            if (di < 0) continue;
                            var k = dl.substring(0, di);
                            var v = dl.substring(di + 1).replace(/\\:/g, ':');
                            fields[k] = v;
                        }
                    }
                    var ts = parseInt(fields['connection.timestamp'] || '0', 10);
                    results[i] = {
                        name:          name,
                        ssid:          fields['802-11-wireless.ssid'] || name,
                        security:      fields['802-11-wireless-security.key-mgmt'] || '',
                        autoconnect:   (fields['connection.autoconnect'] || '').toLowerCase() === 'yes',
                        lastConnected: ts > 0 ? ts : null
                    };
                    if (--pending === 0) {
                        // Sort by last-connected descending so the
                        // most recently used profiles top the
                        // list. Nulls (never connected) sink to
                        // the bottom in name order.
                        results.sort(function(a, b) {
                            if (a.lastConnected && b.lastConnected) return b.lastConnected - a.lastConnected;
                            if (a.lastConnected) return -1;
                            if (b.lastConnected) return 1;
                            return a.name.localeCompare(b.name);
                        });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ networks: results }));
                    }
                });
            });
        });
        return;
    }
    if (req.url === '/api/airplane' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(airplaneCache));
        return;
    }
    if (req.url === '/api/led/manual' && req.method === 'POST') {
        // Network-LED tuning takeover. When `enabled: true` the
        // periodic apply loop steps aside so direct /api/led/set
        // writes from the testing scene aren't trampled. When
        // `enabled: false` the auto state takes over again
        // immediately (fires applyLedsFromState() so the LEDs
        // snap back to their state-driven look without waiting
        // for the next tick).
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            ledManualMode = !!(data && data.enabled);
            if (!ledManualMode) applyLedsFromState();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, enabled: ledManualMode }));
        });
        return;
    }
    if (req.url === '/api/led/set' && req.method === 'POST') {
        // Direct LED control — used by the Network LEDs testing
        // scene. Body: { led: 'wifi'|'eth0'|'eth1'|'link',
        //                 r, g, b, on }.  RGB values clamped to
        // 0-255. When on=false the LED is turned off (brightness
        // 0) regardless of the colour values. Effective only in
        // manual mode (the auto-loop will overwrite otherwise).
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            var ledMap = {
                'wifi': 'flipper-one:rgb:wifi',
                'eth0': 'flipper-one:rgb:eth0',
                'eth1': 'flipper-one:rgb:eth1',
                'link': 'flipper-one:rgb:link'
            };
            var sysled = ledMap[(data && data.led) || ''];
            if (!sysled) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Unknown LED' }));
                return;
            }
            function clamp(v) {
                v = parseInt(v, 10);
                if (isNaN(v)) v = 0;
                if (v < 0)   v = 0;
                if (v > 255) v = 255;
                return v;
            }
            var r  = clamp(data.r);
            var g  = clamp(data.g);
            var b  = clamp(data.b);
            var on = !!(data && data.on);
            if (on) {
                applyLedTarget(sysled, {
                    trigger:         'none',
                    multi_intensity: r + ' ' + g + ' ' + b,
                    brightness:      '255'
                });
            } else {
                ledOff(sysled);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, led: data.led, r: r, g: g, b: b, on: on }));
        });
        return;
    }
    if (req.url === '/api/led/link' && req.method === 'GET') {
        // Tiny status query so callers can confirm what they
        // last set without keeping their own bookkeeping.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ on: ledLinkOn, color: 'blue' }));
        return;
    }
    if (req.url === '/api/led/link' && req.method === 'POST') {
        // Hand-off endpoint for OTHER applications to control the
        // physical "Link" RGB LED. Body: `{ on: bool }`. Solid
        // blue at full brightness when on; off (brightness 0)
        // when off. Colour is hard-wired — callers don't pick.
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            ledLinkOn = !!(data && data.on);
            applyLedsFromState();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, on: ledLinkOn }));
        });
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
    if (req.url === '/api/record/list' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ files: getRecordings() }));
        return;
    }
    if (req.url === '/api/record/status' && req.method === 'GET') {
        var st = { recording: !!recordChild };
        if (recordState) {
            st.file      = recordState.file;
            st.elapsedMs = Date.now() - recordState.startedAt;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(st));
        return;
    }
    if (req.url === '/api/record/start' && req.method === 'POST') {
        var startResult = startRecording();
        res.writeHead(startResult.success ? 200 : 500,
                      { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(startResult));
        return;
    }
    if (req.url === '/api/record/stop' && req.method === 'POST') {
        var stopResult = stopRecording();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stopResult));
        return;
    }
    if (req.url === '/api/record/delete' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.file) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var delResult = deleteRecording(data.file);
            res.writeHead(delResult.success ? 200 : 400,
                          { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(delResult));
        });
        return;
    }
    if (req.url === '/api/record/play' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.file) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var playResult = playRecording(data.file);
            res.writeHead(playResult.success ? 200 : 400,
                          { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(playResult));
        });
        return;
    }
    if (req.url === '/api/record/level' && req.method === 'GET') {
        // Server-Sent Events stream of the current peak level
        // (0..1). Clients (the RecordingScene VU meter) subscribe
        // while a recording is active; we push every 100 ms in
        // lockstep with the level poller's update cadence.
        // When no recording is active `recordLevel` is 0, so the
        // stream still works (just shows silence) without
        // additional gating.
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive'
        });
        var sendLevel = function() {
            try { res.write('data: ' + recordLevel.toFixed(4) + '\n\n'); }
            catch (e) { /* socket gone — interval gets cleared on close */ }
        };
        var levelInt = setInterval(sendLevel, 100);
        sendLevel();   // emit one immediately so the meter doesn't sit at 0
        req.on('close', function() { clearInterval(levelInt); });
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
    // ── /api/sound/outputs ──────────────────────────────────────
    // High-level outputs for the radio app's picker — see
    // getSoundOutputs() for the rationale (Speaker / Headphone
    // are split out of the NAU8822 card; HDMI / DP appear when
    // present; Loopback is hidden).
    if (req.url === '/api/sound/outputs' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getSoundOutputs()));
        return;
    }
    if (req.url === '/api/sound/output' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.id) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var outResult = setSoundOutput(data.id);
            res.writeHead(outResult.success ? 200 : 400,
                          { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(outResult));
        });
        return;
    }
    if (req.url === '/api/sound/restart-driver' && req.method === 'POST') {
        var driverResult = restartAudioDriver();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(driverResult));
        return;
    }
    // ── /api/radio/status ───────────────────────────────────────
    // Reports whether the mpg123 binary needed for internet-radio
    // streaming is installed. The Internet radio scene polls this
    // on `enter()` and gates the rest of the app behind an
    // install modal when the binary is missing.
    if (req.url === '/api/radio/status' && req.method === 'GET') {
        var mpg123Installed = false;
        try {
            execSync('which mpg123', { timeout: 2000 });
            mpg123Installed = true;
        } catch (e) { /* not installed */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ mpg123Installed: mpg123Installed }));
        return;
    }
    // ── /api/radio/play ─────────────────────────────────────────
    // Starts streaming the given URL via mpg123. Shares the same
    // audioChild slot as /api/sound/play, so kicking off a radio
    // stream stops any file playback that's already in flight
    // (and vice-versa) — exactly the existing one-thing-at-a-
    // time invariant the rest of the audio stack assumes.
    if (req.url === '/api/radio/play' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err || !data || !data.url) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Invalid request' }));
                return;
            }
            var radioResult = playRadioStream(data.url);
            res.writeHead(radioResult.success ? 200 : 400,
                          { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(radioResult));
        });
        return;
    }
    // ── /api/radio/stop ─────────────────────────────────────────
    // Same code path as /api/sound/stop — the radio stream is
    // just another `audioChild`, and `stopSound()` doesn't care
    // which producer started it.
    if (req.url === '/api/radio/stop' && req.method === 'POST') {
        stopSound();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
    }
    // ── /api/walkie/play ────────────────────────────────────────
    // Start the Walkie Talkie audio loop. The scene's enter()
    // hits this once on open; the server then keeps respawning
    // sox on each child exit until /api/walkie/stop (or any
    // other stopSound() caller) breaks the loop.
    if (req.url === '/api/walkie/play' && req.method === 'POST') {
        var wResult = startWalkieLoop();
        res.writeHead(wResult.success ? 200 : 400,
                      { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wResult));
        return;
    }
    // ── /api/walkie/stop ────────────────────────────────────────
    // Stop the loop. Idempotent — safe to call from exit() even
    // if the scene never managed to start the loop.
    if (req.url === '/api/walkie/stop' && req.method === 'POST') {
        var wsResult = stopWalkieLoop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wsResult));
        return;
    }
    // ── /api/mic/level/start ─────────────────────────────────────
    // Spawns arecord on hw:1,0 so subsequent /api/mic/level GETs
    // return live peak values for both channels. Idempotent.
    if (req.url === '/api/mic/level/start' && req.method === 'POST') {
        var mlsResult = startMicLevelMonitor();
        res.writeHead(mlsResult.success ? 200 : 400,
                      { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mlsResult));
        return;
    }
    // ── /api/mic/level/stop ──────────────────────────────────────
    // Kill the arecord child. Idempotent — safe to call on scene
    // exit even if the monitor was never started.
    if (req.url === '/api/mic/level/stop' && req.method === 'POST') {
        var mlxResult = stopMicLevelMonitor();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(mlxResult));
        return;
    }
    // ── /api/mic/level ───────────────────────────────────────────
    // Latest peak amplitudes (0..100 integer percent) for both
    // stereo channels. Returns 0/0 when the monitor isn't running.
    if (req.url === '/api/mic/level' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ left: micLeft, right: micRight }));
        return;
    }
    // ── /api/mic/level/stream ────────────────────────────────────
    // Server-Sent Events stream — one persistent connection, the
    // server pushes `data: {"left":N,"right":N}\n\n` lines every
    // time arecord delivers a chunk (rate-limited to ~20 Hz inside
    // notifyMicSubscribers). Replaces the 50-ms polling loop the
    // scene used to run: one HTTP transaction instead of N per
    // second, so the Node event loop stays free for other things
    // (e.g. the touchpad event stream).
    if (req.url === '/api/mic/level/stream' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-store, no-transform',
            'Connection':    'keep-alive',
            // Disable proxy buffering for environments that
            // honour this hint (nginx, etc.). Harmless otherwise.
            'X-Accel-Buffering': 'no'
        });
        // Seed the client with the current state so the meters
        // don't sit at 0 until the next arecord chunk arrives.
        res.write('data: ' + JSON.stringify({ left: micLeft, right: micRight }) + '\n\n');
        micSubscribers.push(res);
        // Cleanup on either side closing the socket. Both events
        // can fire; the indexOf-guard makes the splice idempotent.
        var drop = function() {
            var idx = micSubscribers.indexOf(res);
            if (idx >= 0) micSubscribers.splice(idx, 1);
        };
        req.on('close', drop);
        req.on('error', drop);
        res.on('close', drop);
        res.on('error', drop);
        return;
    }
    // ── /api/radio/install ──────────────────────────────────────
    // Installs mpg123 via apt-get. The node server runs as root
    // (it already invokes audio-driver-restart.sh which requires
    // root), so plain apt-get works — no sudo wrapper needed.
    // DEBIAN_FRONTEND=noninteractive avoids any debconf prompt
    // that would otherwise hang the request; --no-install-recommends
    // keeps the install lean. Synchronous: the package is small
    // and the transaction fits inside the 60 s timeout.
    if (req.url === '/api/radio/install' && req.method === 'POST') {
        var instOk = false;
        var instOut = '';
        try {
            instOut = execSync(
                'DEBIAN_FRONTEND=noninteractive apt-get install -y ' +
                '--no-install-recommends mpg123 2>&1',
                { encoding: 'utf8', timeout: 60000 });
            instOk = true;
        } catch (e) {
            instOut = (e.stdout || '') + (e.stderr || '') + (e.message || '');
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: instOk,
            output:  instOut.slice(-1000)
        }));
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
    if (req.url === '/api/system/reboot' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));

        // Detach the reboot into a transient unit so the OS can
        // tear our process down without killing the command
        // mid-flight (the same trick /api/switch/flipctl uses for
        // its restart). systemd-run --collect --no-block runs
        // outside our cgroup; unref keeps node from waiting on it.
        var sysSpawn = require('child_process').spawn;
        sysSpawn('systemd-run', ['--collect', '--no-block', 'sh', '-c', 'sudo reboot'], {
            detached: true,
            stdio: 'ignore'
        }).unref();
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
        startRefreshLoop('wifi',         refreshWifi,        2000);
        startRefreshLoop('wifi-rescan',  triggerWifiRescan, 20000);
        startRefreshLoop('wifi-scan',    refreshWifiScan,    5000);
        startRefreshLoop('wifi-power',   refreshWifiPower,   3000);
        startRefreshLoop('ethernet', refreshEthernet, 2000);
        startRefreshLoop('routing',  refreshRouting,  5000);
        startRefreshLoop('airplane', refreshAirplane, 3000);
        startRefreshLoop('disk',     refreshDisk,    30000);
        // Network LEDs refresher — diff-applies the current
        // target state every second. Cheap (no shell call when
        // nothing changed) and keeps the LEDs in sync with the
        // wifi / ethernet caches even if a refresh cycle skips
        // a beat.
        startRefreshLoop('network-leds', applyLedsFromState, 1000);
    }
});
