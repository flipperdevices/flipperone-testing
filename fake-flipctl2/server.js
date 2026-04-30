#!/usr/bin/env node
'use strict';

var http = require('http');
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');
var execSync = require('child_process').execSync;
var exec = require('child_process').exec;

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

// ── Touchpad raw event reader ──────────────────────────────────────────
//
// The Flipper One ships a touchpad evdev device named "Flipper One
// Touchpad" exposing ABS_X (0..1024), ABS_Y (0..800), ABS_PRESSURE
// (0..12288), plus BTN_TOUCH / BTN_TOOL_FINGER. We open it on server
// startup, parse 24-byte struct input_event records, and maintain a
// running snapshot the HTTP layer can hand out at request time.
//
// Multiple readers are allowed by the kernel as long as no consumer
// has called EVIOCGRAB; on FlipperOne the cog/libinput stack normally
// shares the device, so this background reader works alongside the
// regular cursor pipeline. If the device can't be opened (e.g. dev
// machine on macOS, or missing file), `available` stays false and the
// /api/touchpad endpoint reports it so the UI can show a hint.
var INPUT_EVENT_SIZE = 24;            // sec(8)+usec(8)+type(2)+code(2)+value(4)
var EV_SYN = 0, EV_KEY = 1, EV_ABS = 3;
var SYN_REPORT = 0, BTN_TOUCH = 330, ABS_X = 0, ABS_Y = 1, ABS_PRESSURE = 24;

var touchpadState = {
    available: false,
    devName: null,
    devPath: null,
    touching: false,
    x: 0, y: 0, pressure: 0,
    touchdownX: 0, touchdownY: 0,
    maxX: 1024, maxY: 800, maxPressure: 12288,
    eventCount: 0,
    lastEventAt: 0
};

function findTouchpadDevice() {
    var root = '/sys/class/input';
    var entries;
    try { entries = fs.readdirSync(root); }
    catch (e) { return null; }
    for (var i = 0; i < entries.length; i++) {
        var name = entries[i];
        if (!/^event\d+$/.test(name)) continue;
        var nameFile = root + '/' + name + '/device/name';
        try {
            var devName = fs.readFileSync(nameFile, 'utf8').trim();
            if (devName.toLowerCase().indexOf('touchpad') !== -1) {
                return { name: devName, path: '/dev/input/' + name };
            }
        } catch (e) { /* ignore */ }
    }
    return null;
}

function startTouchpadReader() {
    var dev = findTouchpadDevice();
    if (!dev) {
        console.warn('[touchpad] no input device found; /api/touchpad will report unavailable');
        return;
    }
    touchpadState.devName = dev.name;
    touchpadState.devPath = dev.path;
    touchpadState.available = true;

    var stream;
    try {
        stream = fs.createReadStream(dev.path);
    } catch (e) {
        console.warn('[touchpad] failed to open ' + dev.path + ': ' + e.message);
        touchpadState.available = false;
        return;
    }

    var pendingTouchdown = false;
    var leftover = Buffer.alloc(0);

    stream.on('data', function(chunk) {
        // Glue together what we have with the new chunk; the kernel
        // hands us full-event-aligned reads almost always, but we
        // play it safe and buffer any partial trailing record.
        var buf = leftover.length === 0
            ? chunk
            : Buffer.concat([leftover, chunk]);

        var off = 0;
        while (off + INPUT_EVENT_SIZE <= buf.length) {
            // Skip the 16-byte timeval; we only care about type/code/value.
            var type  = buf.readUInt16LE(off + 16);
            var code  = buf.readUInt16LE(off + 18);
            var value = buf.readInt32LE (off + 20);
            off += INPUT_EVENT_SIZE;

            if (type === EV_KEY && code === BTN_TOUCH) {
                if (value === 1 && !touchpadState.touching) {
                    // BTN_TOUCH=1 arrives before the same-frame ABS_X/Y
                    // values; defer capturing the touchdown position
                    // until SYN_REPORT lands.
                    pendingTouchdown = true;
                }
                touchpadState.touching = (value === 1);
                if (value === 0) {
                    touchpadState.pressure = 0;
                }
            } else if (type === EV_ABS) {
                if (code === ABS_X)            touchpadState.x = value;
                else if (code === ABS_Y)       touchpadState.y = value;
                else if (code === ABS_PRESSURE) touchpadState.pressure = value;
            } else if (type === EV_SYN && code === SYN_REPORT) {
                if (pendingTouchdown) {
                    touchpadState.touchdownX = touchpadState.x;
                    touchpadState.touchdownY = touchpadState.y;
                    pendingTouchdown = false;
                }
                touchpadState.eventCount++;
                touchpadState.lastEventAt = Date.now();
            }
        }
        leftover = (off < buf.length) ? buf.slice(off) : Buffer.alloc(0);
    });

    stream.on('error', function(e) {
        console.warn('[touchpad] read error: ' + e.message);
        touchpadState.available = false;
    });

    console.log('[touchpad] streaming from ' + dev.path + ' (' + dev.name + ')');
}

function getTouchpadInfo() {
    return {
        available: touchpadState.available,
        device: touchpadState.devName,
        touching: touchpadState.touching,
        x: touchpadState.x,
        y: touchpadState.y,
        pressure: touchpadState.pressure,
        touchdownX: touchpadState.touchdownX,
        touchdownY: touchpadState.touchdownY,
        maxX: touchpadState.maxX,
        maxY: touchpadState.maxY,
        maxPressure: touchpadState.maxPressure,
        eventCount: touchpadState.eventCount,
        lastEventAt: touchpadState.lastEventAt
    };
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

function getModemInfo() {
    var result = { available: false };

    // 1. ModemManager info (operator, tech, signal, model, bearer)
    var mm;
    try {
        var mmRaw = execSync('mmcli -m 0 -J 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
        mm = JSON.parse(mmRaw);
    } catch (e) {
        return result;
    }

    var modem = mm.modem || mm;
    result.available = true;

    result.model = deepGet(modem, 'generic.model') || deepGet(modem, 'hardware.model') || null;
    result.operator = deepGet(modem, '3gpp.operator-name') || null;
    result.operatorCode = deepGet(modem, '3gpp.operator-code') || null;
    result.state = deepGet(modem, 'generic.state') || null;

    // Access technologies
    var techs = deepGet(modem, 'generic.access-technologies') || [];
    if (typeof techs === 'string') techs = techs.split(',').map(function(s) { return s.trim(); });
    result.accessTech = techs;

    // Signal quality
    var sq = deepGet(modem, 'generic.signal-quality');
    if (sq && typeof sq === 'object') {
        result.signalQuality = parseInt(sq.value, 10) || null;
    } else if (sq) {
        result.signalQuality = parseInt(sq, 10) || null;
    } else {
        result.signalQuality = null;
    }

    // IP + interface from bearer
    result.ip4 = null;
    result.ip6 = null;
    result.iface = null;
    var bearers = deepGet(modem, 'generic.bearers') || [];
    if (bearers.length > 0) {
        var bPath = bearers[bearers.length - 1];
        var bNum = bPath.match(/(\d+)$/);
        if (bNum) {
            try {
                var bRaw = execSync('mmcli -b ' + bNum[1] + ' -J 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
                var bearer = JSON.parse(bRaw);
                var b = bearer.bearer || bearer;
                result.ip4 = deepGet(b, 'ipv4-config.address') || null;
                result.ip6 = deepGet(b, 'ipv6-config.address') || null;
                result.iface = deepGet(b, 'status.interface') || null;
            } catch (e) {}
        }
    }

    // Bandwidth from sysfs byte counters
    var bw = getBandwidth(result.iface);
    result.dlMbps = bw.dlMbps;
    result.ulMbps = bw.ulMbps;

    // 2. QMI serving system (cell ID, TAC, MCC/MNC)
    try {
        var ss = execSync('qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-serving-system 2>/dev/null',
            { encoding: 'utf8', timeout: 2000 });
        result.cellId = rxMatch(ss, /3GPP cell ID:\s*'(\d+)'/);
        result.tac = rxMatch(ss, /LTE tracking area code:\s*'(\d+)'/);
        result.mcc = rxMatch(ss, /MCC:\s*'(\d+)'/);
        result.mnc = rxMatch(ss, /MNC:\s*'(\d+)'/);
    } catch (e) {}

    // 3. QMI cell location info (EARFCN, PCI, band)
    try {
        var cl = execSync('qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-cell-location-info 2>/dev/null',
            { encoding: 'utf8', timeout: 2000 });
        var earfcnMatch = cl.match(/EUTRA Absolute RF Channel Number:\s*'(\d+)'\s*\(([^)]+)\)/);
        if (earfcnMatch) {
            result.earfcn = earfcnMatch[1];
            result.band = earfcnMatch[2];
        }
        result.pci = rxMatch(cl, /Serving Cell ID:\s*'(\d+)'/);
    } catch (e) {}

    // 4. QMI signal strength (RSRP, RSRQ, SINR)
    try {
        var sig = execSync('qmicli -d ' + QMI_DEV + ' --device-open-proxy --nas-get-signal-strength 2>/dev/null',
            { encoding: 'utf8', timeout: 2000 });
        result.rsrp = rxMatch(sig, /RSRP:[\s\S]*?Network '[^']*':\s*'([^']+)'/);
        result.rsrq = rxMatch(sig, /RSRQ:[\s\S]*?Network '[^']*':\s*'([^']+)'/);
        result.sinr = rxMatch(sig, /SINR[^:]*:\s*'([^']+)'/);
    } catch (e) {}

    return result;
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

function getRoutingInfo() {
    var routes = [];
    try {
        var out4 = execSync('ip -4 route show default 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
        var lines4 = out4.trim().split('\n');
        for (var i = 0; i < lines4.length; i++) {
            if (!lines4[i]) continue;
            var m4 = lines4[i].match(/default via (\S+) dev (\S+).*?metric (\d+)/);
            if (m4) routes.push({ family: 'IPv4', gateway: m4[1], dev: m4[2], metric: parseInt(m4[3], 10) });
            else {
                var m4b = lines4[i].match(/default via (\S+) dev (\S+)/);
                if (m4b) routes.push({ family: 'IPv4', gateway: m4b[1], dev: m4b[2], metric: null });
            }
        }
    } catch (e) {}
    try {
        var out6 = execSync('ip -6 route show default 2>/dev/null', { encoding: 'utf8', timeout: 2000 });
        var lines6 = out6.trim().split('\n');
        for (var j = 0; j < lines6.length; j++) {
            if (!lines6[j]) continue;
            var m6 = lines6[j].match(/default via (\S+) dev (\S+).*?metric (\d+)/);
            if (m6) routes.push({ family: 'IPv6', gateway: m6[1], dev: m6[2], metric: parseInt(m6[3], 10) });
            else {
                var m6b = lines6[j].match(/default via (\S+) dev (\S+)/);
                if (m6b) routes.push({ family: 'IPv6', gateway: m6b[1], dev: m6b[2], metric: null });
            }
        }
    } catch (e) {}
    return routes;
}

// `flipusb0` is the USB-gadget Ethernet device created on builds
// that ship the cdc_ether/g_ether kernel module. NetworkManager
// usually treats it as `unmanaged`, so its IPs (typically a
// link-local 169.254.x.x set by a startup script) won't appear
// via `nmcli device show` — the fallback `ip -j addr show <iface>`
// pass below picks them up.
var ETH_IFACES = ['end0', 'end1', 'flipusb0'];

function getEthernetInfo() {
    var ifaces = [];
    for (var i = 0; i < ETH_IFACES.length; i++) {
        var name = ETH_IFACES[i];
        // Skip interfaces the kernel doesn't have. flipusb0 only
        // exists on builds where the USB-gadget driver creates it;
        // we don't want a phantom "unavailable" tab cluttering the
        // page on builds without it.
        if (!fs.existsSync('/sys/class/net/' + name)) continue;

        var info = { name: name, state: null, ip4: [], ip6: [], gateway4: null, gateway6: null, dns: [] };
        try {
            var out = execSync('nmcli -t device show ' + name + ' 2>/dev/null', { encoding: 'utf8', timeout: 3000 });
            var lines = out.split('\n');
            for (var j = 0; j < lines.length; j++) {
                var parts = lines[j].split(':');
                var key = parts[0];
                var val = parts.slice(1).join(':');
                if (key === 'GENERAL.STATE') {
                    info.state = val;
                } else if (key.match(/^IP4\.ADDRESS/)) {
                    info.ip4.push(val);
                } else if (key.match(/^IP6\.ADDRESS/)) {
                    info.ip6.push(val);
                } else if (key === 'IP4.GATEWAY') {
                    info.gateway4 = val || null;
                } else if (key === 'IP6.GATEWAY') {
                    info.gateway6 = val || null;
                } else if (key.match(/^IP4\.DNS/)) {
                    info.dns.push(val);
                }
            }
        } catch (e) {
            info.state = 'unavailable';
        }
        // Kernel-level carrier flips the moment the cable moves; nmcli
        // can lag by a second or two. Force the state to "disconnected"
        // whenever the kernel reports no carrier so the UI reflects
        // physical disconnection immediately.
        var carrier = readSysInt('/sys/class/net/' + name + '/carrier');
        if (carrier === 0) {
            info.state = 'disconnected (no carrier)';
        }
        // Link speed via ethtool — skip the call entirely when the
        // cable is unplugged, both for speed and because ethtool
        // reports stale/unknown values while auto-negotiation tears
        // down.
        info.speed = null;
        if (carrier !== 0) {
            try {
                var ethraw = execSync('ethtool ' + name + ' 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
                var speedMatch = ethraw.match(/^\s*Speed:\s*([^\s]+)/m);
                if (speedMatch && speedMatch[1] !== 'Unknown!' && speedMatch[1] !== 'Unknown') {
                    info.speed = speedMatch[1];
                }
            } catch (e) { /* ignore */ }
        }
        // Cumulative byte counters from sysfs — same source `ip -s link`
        // reports. Missing counters (very rare) land as null so the
        // client can show em-dash or blank.
        info.rxBytes = readSysInt('/sys/class/net/' + name + '/statistics/rx_bytes');
        info.txBytes = readSysInt('/sys/class/net/' + name + '/statistics/tx_bytes');

        // Fallback for unmanaged interfaces (flipusb0 and friends):
        // when nmcli yielded no addresses but the kernel DOES have
        // them bound (e.g. assigned by a startup script), pull them
        // straight from `ip -j addr show <iface>`. We only run this
        // when nmcli came back empty AND the kernel sees the iface
        // up — saves a fork on the common managed case.
        // The iproute2 JSON output uses {local, prefixlen} pairs;
        // we glue them back to the "addr/cidr" string nmcli would
        // have produced so downstream consumers (the Desktop card,
        // the verbose modal) don't have to know the difference.
        if (info.ip4.length === 0 && carrier !== 0) {
            try {
                var ipraw = execSync('ip -j addr show ' + name + ' 2>/dev/null',
                    { encoding: 'utf8', timeout: 1500 });
                var ipdata = JSON.parse(ipraw);
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
                    // nmcli might have reported "unmanaged" / empty
                    // here. If we just found addresses, the link is
                    // effectively connected — relabel so isConnected()
                    // on the client and the modal status both read
                    // "connected" rather than the unmanaged state.
                    if (info.ip4.length > 0
                        && (!info.state || info.state.indexOf('connected') === -1)) {
                        info.state = 'connected';
                    }
                }
            } catch (e) { /* ip missing or no JSON support — skip */ }
        }

        // IPv4 method on the currently-active connection for this
        // device (auto | manual | shared | link-local | disabled).
        // Only bothered when carrier is up — saves two nmcli calls
        // when the cable is unplugged.
        info.ipv4Method = null;
        if (carrier !== 0) {
            try {
                var actRaw = execSync('nmcli -t -f NAME,DEVICE connection show --active 2>/dev/null', { encoding: 'utf8', timeout: 1500 });
                var actLines = actRaw.split('\n');
                var connName = null;
                for (var ai = 0; ai < actLines.length; ai++) {
                    var ln = actLines[ai];
                    if (!ln) continue;
                    // nmcli -t escapes colons in values as "\:"; split on
                    // the last unescaped colon.
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
                    var methodRaw = execSync(
                        'nmcli -t -f ipv4.method connection show "' + connName.replace(/"/g, '\\"') + '" 2>/dev/null',
                        { encoding: 'utf8', timeout: 1500 }
                    );
                    var mm = methodRaw.match(/ipv4\.method:(.+)/);
                    if (mm) info.ipv4Method = mm[1].trim();
                }
            } catch (e) { /* ignore */ }
        }
        ifaces.push(info);
    }
    return ifaces;
}

function getDiskInfo() {
    var result = { device: '/dev/mmcblk0p2', mounted: false };
    try {
        // df outputs: Filesystem 1K-blocks Used Available Use% Mounted-on
        var out = execSync('df -k /dev/mmcblk0p2 2>/dev/null', { encoding: 'utf8' });
        var lines = out.trim().split('\n');
        if (lines.length >= 2) {
            var parts = lines[1].trim().split(/\s+/);
            var totalKB = parseInt(parts[1], 10);
            var usedKB = parseInt(parts[2], 10);
            result.mounted = true;
            result.totalGB = +(totalKB / 1048576).toFixed(1);
            result.usedGB = +(usedKB / 1048576).toFixed(1);
        }
    } catch (e) {
        // device not mounted or doesn't exist
    }
    return result;
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
function getWifiInfo() {
    try {
        var active = execSync('nmcli -t -f NAME,TYPE,STATE c show --active',
            { encoding: 'utf8', timeout: 2000 });
        var wifiName = null;
        var lines = active.split('\n');
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
        if (!wifiName) {
            return { connected: false, quality: 0, ssid: '', iface: '', ip4: [], ip6: [] };
        }

        // Connected. Find the device bound to this connection, then query
        // kernel-side link signal via `iw`.
        var ssid = wifiName;
        var quality = 0;
        var iface = null;
        var ip4 = [];
        var ip6 = [];
        try {
            var dev = execSync(
                'nmcli -t -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.CONNECTION d show',
                { encoding: 'utf8', timeout: 2000 });
            var blocks = dev.split(/\n(?=GENERAL\.DEVICE:)/);
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
                var link = execSync('iw dev ' + iface + ' link',
                    { encoding: 'utf8', timeout: 1500 });
                var ssidM = link.match(/SSID:\s*(.+)/);
                if (ssidM) ssid = ssidM[1].trim();
                var sigM = link.match(/signal:\s*(-?\d+)\s*dBm/);
                if (sigM) {
                    // dBm → 0-100 quality. -50 ≈ 100, -100 ≈ 0.
                    var dbm = parseInt(sigM[1], 10);
                    quality = Math.max(0, Math.min(100, 2 * (dbm + 100)));
                }
            }
        } catch (e) { /* iw missing; fall back */ }

        // IP addresses for the bound interface — same source the
        // ethernet endpoint uses (`nmcli -t device show <iface>`),
        // so the desktop's renderer can reuse `drawEthCard` without
        // any schema fork. Failure leaves ip4/ip6 empty arrays; the
        // client treats that as "no addresses yet" and skips the
        // card on render.
        if (iface) {
            try {
                var ipout = execSync('nmcli -t device show ' + iface + ' 2>/dev/null',
                    { encoding: 'utf8', timeout: 2000 });
                var ipLines = ipout.split('\n');
                for (var li = 0; li < ipLines.length; li++) {
                    var lp = ipLines[li].split(':');
                    var key = lp[0];
                    var val = lp.slice(1).join(':');
                    if (key.match(/^IP4\.ADDRESS/))      ip4.push(val);
                    else if (key.match(/^IP6\.ADDRESS/)) ip6.push(val);
                }
            } catch (e) { /* keep arrays empty */ }
        }

        // Fallback: grab signal from the scan list if iw didn't work.
        if (quality === 0) {
            try {
                var scan = execSync('nmcli -t -f IN-USE,SSID,SIGNAL dev wifi',
                    { encoding: 'utf8', timeout: 2000 });
                var sl = scan.split('\n');
                for (var j = 0; j < sl.length; j++) {
                    if (!sl[j] || sl[j][0] !== '*') continue;
                    var sp = sl[j].replace(/\\:/g, '\x01').split(':').map(
                        function(p) { return p.replace(/\x01/g, ':'); });
                    var s = parseInt(sp[2], 10);
                    if (!isNaN(s)) quality = Math.max(0, Math.min(100, s));
                    if (sp[1]) ssid = sp[1];
                    break;
                }
            } catch (e) { /* keep defaults */ }
        }

        return {
            connected: true,
            quality: quality,
            ssid: ssid,
            iface: iface || '',
            ip4: ip4,
            ip6: ip6
        };
    } catch (e) { /* nmcli missing or failed */ }
    return { connected: false, quality: 0, ssid: '', iface: '', ip4: [], ip6: [] };
}

function getAirplaneMode() {
    try {
        var raw = execSync('nmcli -t -f WIFI,WWAN radio', { encoding: 'utf8', timeout: 2000 });
        var line = raw.split('\n').find(function(l) { return l; }) || '';
        var parts = line.split(':');
        var wifi = parts[0] || '';
        var wwan = parts[1] || '';
        // Airplane mode is "on" when every managed radio is disabled.
        return { enabled: wifi === 'disabled' && wwan === 'disabled' };
    } catch (e) { /* nmcli missing */ }
    return { enabled: false };
}

function setAirplaneMode(enabled) {
    try {
        execSync('nmcli radio all ' + (enabled ? 'off' : 'on'), { encoding: 'utf8', timeout: 3000 });
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
    }
}

var server = http.createServer(function(req, res) {
    if (req.url === '/api/wifi') {
        var wifi = getWifiInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(wifi));
        return;
    }
    if (req.url === '/api/airplane' && req.method === 'GET') {
        var a = getAirplaneMode();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(a));
        return;
    }
    if (req.url === '/api/airplane' && req.method === 'POST') {
        readJsonBody(req, function(err, data) {
            if (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
                return;
            }
            var result = setAirplaneMode(!!(data && data.enabled));
            res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(Object.assign({ enabled: !!(data && data.enabled) }, result)));
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
    if (req.url === '/api/touchpad') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getTouchpadInfo()));
        return;
    }
    if (req.url === '/api/modem') {
        var modem = getModemInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(modem));
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
        var routing = getRoutingInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(routing));
        return;
    }
    if (req.url === '/api/ethernet') {
        var eth = getEthernetInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(eth));
        return;
    }
    if (req.url === '/api/disk') {
        var info = getDiskInfo();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
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
    // Touchpad reader is Linux-only and silently no-ops on macOS dev hosts.
    if (process.platform === 'linux') {
        try { startTouchpadReader(); }
        catch (e) { console.warn('[touchpad] startup failed: ' + e.message); }
    }
});
