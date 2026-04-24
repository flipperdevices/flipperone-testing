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

var ETH_IFACES = ['end0', 'end1'];

function getEthernetInfo() {
    var ifaces = [];
    for (var i = 0; i < ETH_IFACES.length; i++) {
        var name = ETH_IFACES[i];
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
        if (!wifiName) return { connected: false, quality: 0, ssid: '' };

        // Connected. Find the device bound to this connection, then query
        // kernel-side link signal via `iw`.
        var ssid = wifiName;
        var quality = 0;
        try {
            var dev = execSync(
                'nmcli -t -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.CONNECTION d show',
                { encoding: 'utf8', timeout: 2000 });
            var iface = null;
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

        return { connected: true, quality: quality, ssid: ssid };
    } catch (e) { /* nmcli missing or failed */ }
    return { connected: false, quality: 0, ssid: '' };
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
});
