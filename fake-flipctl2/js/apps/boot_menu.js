/**
 * BootMenuScene
 *
 * Main-menu "Boot Menu": a titled header with a full-width auto-start
 * progress bar (inverts the header text as it fills), a scrollable list of
 * bootable profiles (from list-profiles) with icons and a "Used <when>"
 * column, a rounded selector, and Info / Edit soft buttons over the X / V
 * keys. Rows use HaxrCorp so the label keeps one baseline in every state.
 *
 * Any key press cancels the auto-start countdown (bar empties and stops,
 * countdown text hides). Selecting/booting is not wired yet.
 */
var BootMenuScene = (function() {
    var CONTAINER_X    = 5;      // icon lands at x = 8
    var HEADER_H       = 18;     // title bar height
    var CONTAINER_Y    = 20;     // first row top (below the header)
    var DIVIDER_COLOR  = '#CCCCCC';

    var SELECTOR_X             = 4;
    var SELECTOR_W_WITH_SCROLL = 244;
    var SELECTOR_W_NO_SCROLL   = 247;
    var SELECTOR_H             = 16;
    var SELECTOR_CORNER_R      = 3;
    var SELECTOR_Y_OFFSET      = 0;   // 16px frame on the 16px row

    var SCROLLBAR_X         = 253;
    var SCROLLBAR_THUMB_PAD  = 1;

    var VISIBLE_COUNT = 6;
    var ICON_BOX_W    = 12;   // fixed icon column so labels line up
    var ROW_H         = 16;   // row height (tighter than MenuLine.H = 20)
    var TIMEOUT_MS    = 5000; // auto-start countdown before loading the default

    function ic(name) { return (typeof Icons !== 'undefined') ? Icons[name] : null; }

    // Display name of a profile: drop the leading '@' subvol marker.
    function dispName(n) { return String(n || '').replace(/^@/, ''); }

    // Base name from origin_stock_name ("@Desktop_944_stock" -> "Desktop").
    function originBase(origin) {
        var m = String(origin || '').match(/^@?(.+)_\d+_stock$/);
        return m ? m[1] : '';
    }

    // Factory (undeletable) profile: its subvol name (minus '@') equals its origin
    // base. Anything else derived from a stock is a user profile.
    function isFactory(name, origin) {
        var base = originBase(origin);
        return base !== '' && dispName(name) === base;
    }

    // Strip a create-profile "_old_<ts>" backup suffix; '' if there is none.
    var OLD_RE = /_old_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/;

    // Menu/display name: factory -> base ("Desktop"); user @Base__label__ -> "[label]"
    // with '-' shown as space; an _old_<ts> backup -> the original's name + " (old)";
    // anything else (legacy user) -> name minus '@' verbatim.
    function profileDisplay(name, origin) {
        var raw = dispName(name);
        if (OLD_RE.test(raw)) return profileDisplay('@' + raw.replace(OLD_RE, ''), origin) + ' (old)';
        var m = raw.match(/^(.+?)__(.+)__$/);
        if (m) return '[' + m[2].replace(/-/g, ' ') + ']';
        return raw;
    }

    // Profile name for popup captions: the display name without the list's
    // [ ] user-edit brackets (e.g. "[My Games]" -> "My Games").
    function plainName(name, origin) {
        return profileDisplay(name, origin).replace(/[\[\]]/g, '');
    }

    // Editable label text for Rename: the user @Base__label__ label with '-'
    // shown as space (backup suffix stripped); legacy names come back whole.
    function profileLabel(name) {
        var raw = dispName(name).replace(OLD_RE, '');
        var m = raw.match(/^(.+?)__(.+)__$/);
        return m ? m[2].replace(/-/g, ' ') : raw;
    }

    // Free text -> a safe subvol label (spaces -> '-', drop everything else).
    function encodeLabel(text) {
        return String(text || '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9-]/g, '').replace(/^-+|-+$/g, '');
    }

    // Icon family key from a base name (or a bare name as fallback).
    function iconKey(s) {
        var n = String(s || '').toLowerCase();
        if (n.indexOf('graphics') >= 0) return 'graphics';
        if (n.indexOf('minimal') >= 0)  return 'minimal';
        if (n.indexOf('desktop') >= 0)  return 'desktop';
        if (n.indexOf('router') >= 0)   return 'router';
        if (n.indexOf('media') >= 0 || n.indexOf('tv') >= 0) return 'media';
        return '';
    }

    // Boot-menu icon for a profile, chosen by its origin base (falls back to the name).
    function bootIcon(name, origin) {
        switch (iconKey(originBase(origin)) || iconKey(name)) {
            case 'graphics': return ic('no_graphics_boot_menu');
            case 'minimal':  return ic('minimal_small');
            case 'desktop':  return ic('small_desktop');
            case 'router':   return ic('router_small');
            case 'media':    return ic('media_small');
            default:         return ic('flipper_os');
        }
    }

    // "Used <when>" relative time (mockup style: singular units). Sentinels:
    // '' / 'never' -> blank, 'now' (the booted profile) -> "Running".
    function usedAgo(lu) {
        lu = lu || '';
        if (lu === '' || lu === 'never') return '';
        if (lu === 'now') return 'Running';
        var t = Date.parse(lu.replace(' ', 'T'));
        if (isNaN(t)) return lu;
        var s = Math.max(0, Math.floor((Date.now() - t) / 1000));
        function u(n, w) { return 'Used ' + n + ' ' + w + (n === 1 ? '' : 's') + ' ago'; }
        if (s < 60) return 'Used just now';
        var m = Math.floor(s / 60);  if (m < 60) return u(m, 'min');
        var h = Math.floor(m / 60);  if (h < 24) return u(h, 'hour');
        var d = Math.floor(h / 24);  if (d < 30) return u(d, 'day');
        var mo = Math.floor(d / 30); if (mo < 12) return u(mo, 'month');
        return u(Math.floor(d / 365), 'year');
    }

    // Split a human size string ("3.5GiB") into [number, unit] so the two parts
    // can be drawn in fixed-width slots. The server sends sizes already
    // formatted (btrfs-show-space); we never reformat them here. null -> ['?',''].
    function sizeParts(s) {
        if (!s) return ['?', ''];
        var m = String(s).match(/^([0-9.]+)\s*(.*)$/);
        return m ? [m[1], m[2]] : [String(s), ''];
    }

    // Larger (14px) icon for the Edit popup header, same base logic as bootIcon.
    function headerIcon(name, origin) {
        switch (iconKey(originBase(origin)) || iconKey(name)) {
            case 'graphics': return ic('no_graphics_14px');
            case 'minimal':  return ic('minimal');
            case 'desktop':  return ic('desktop');
            case 'router':   return ic('router');
            case 'media':    return ic('media');
            default:         return ic('flipper_os');
        }
    }

    function BootMenuScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Boot Menu';
        this.breadcrumbTitle = 'Boot Menu';

        // Entries loaded from list-profiles on enter().
        this.items         = [];
        this.loading       = true;
        this.selectedIndex = 0;      // default: the first line (auto-start target)
        this.scrollOffset  = 0;
        this._autoStart    = true;   // countdown active until a key press
        this._startAt      = 0;      // countdown start (ms); set in enter()
        this._timer        = null;
        this._loadTimer    = null;   // repaint ticker for the loading spinner

        this.selectorFrame = new MenuSelectorFrame({
            x: SELECTOR_X, y: 0, width: SELECTOR_W_WITH_SCROLL, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top', strokeColor: '#000', showStroke: true, showFill: false
        });
        this.scrollbar = new UI.Scrollbar(0, VISIBLE_COUNT, 0);

        // Soft buttons over their physical keys: Info over X ('edit' slot,
        // x=50), Edit over V ('middle' slot, x=156).
        this.infoBtn = new UI.MiddleButton('Info', 0, 48, 2, 'edit', function() {});
        this.infoBtn.x = 50;  this.infoBtn.w = 48;
        this.editBtn = new UI.MiddleButton('Edit', 0, 48, 2, 'del', function() {});
        this.editBtn.x = 156; this.editBtn.w = 48;

        // Edit popup: profile actions for the selected entry. Same selector
        // frame style as the menu rows.
        this._editSelector = new MenuSelectorFrame({
            x: 0, y: 0, width: 10, height: SELECTOR_H,
            anchorH: 'left', anchorV: 'top', strokeColor: '#000', showStroke: true, showFill: false
        });
        this._profiles    = [];
        this._editOpen    = false;
        this._infoOpen    = false;   // read-only Info popup (over the Info button)
        this._editIndex   = 0;
        this._editOptions = ['Rename', 'Clone', 'Factory Reset', 'Delete'];   // recomputed per profile in _openEdit
        this._busy        = null;   // action-in-progress message (e.g. 'Cloning')
        this._actionError = null;   // last action error, dismissed by a key press
        this._confirm     = null;   // { kind, msg1, msg2 } confirmation before a destructive action
        // Auto-boot marker: the server flags the profile matching `flipmeta get
        // boot` (a subvol id) with autoBoot; setting it writes flipmeta set boot.
        this._booting     = null;   // display name of the profile being kexec-booted

        // Profile size (Total + Exclusive), fetched async when the popup
        // opens; a rotating spinner shows while it loads.
        this._size        = { name: null, loading: false, total: null, exclusive: null };
        this._spinIndex   = 0;
        this._spinTimer   = null;
        this._spinFrames  = ['-', '\\', '|', '/'];
        this._numSlotW    = null;   // fixed number/spinner slot width, measured lazily
        this._unitSlotW   = null;   // fixed unit (B/KB/MB/GB) slot width
    }

    BootMenuScene.prototype.enter = function() {
        // Resuming from a pushed child (the Rename keyboard) must not reset the
        // list or reopen the countdown — keep the Edit popup exactly as it was.
        if (this._resumingFromChild) { this._resumingFromChild = false; return; }
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._autoStart = true;   // will start once the profiles arrive
        this._startAt = 0;
        this._fetchProfiles();
        this._startLoadAnim();
    };

    // Repaint while the profile list is loading, so the spinner animates.
    BootMenuScene.prototype._startLoadAnim = function() {
        var self = this;
        if (this._loadTimer) clearInterval(this._loadTimer);
        if (!this.loading) return;
        this._loadTimer = setInterval(function() {
            if (!self.loading) { clearInterval(self._loadTimer); self._loadTimer = null; return; }
            if (window.requestRender) window.requestRender();
        }, 100);
    };
    BootMenuScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._loadTimer) { clearInterval(this._loadTimer); this._loadTimer = null; }
    };

    // Start the auto-start countdown + progress bar. Called only after the
    // profiles have loaded, so the bar never moves against an empty list.
    BootMenuScene.prototype._startCountdown = function() {
        var self = this;
        if (this._timer) clearInterval(this._timer);
        this._startAt = Date.now();
        this._timer = setInterval(function() {
            if (!self._autoStart) { clearInterval(self._timer); self._timer = null; return; }
            if (window.requestRender) window.requestRender();
            if (Date.now() - self._startAt >= TIMEOUT_MS) {
                clearInterval(self._timer);
                self._timer = null;
            }
        }, 100);
    };

    BootMenuScene.prototype._fetchProfiles = function() {
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/boot/profiles', true);
        xhr.timeout = 10000;
        function done(list) { self._setProfiles(list || []); }
        xhr.onload = function() {
            var list = [];
            if (xhr.status === 200) {
                try { list = JSON.parse(xhr.responseText).profiles || []; } catch (e) {}
            }
            done(list);
        };
        xhr.onerror   = function() { done([]); };
        xhr.ontimeout = function() { done([]); };
        xhr.send();
    };

    BootMenuScene.prototype._setProfiles = function(list) {
        var self = this;
        this._profiles = list;
        this.items = list.map(function(p) {
            return new MenuLine({ text: profileDisplay(p.name, p.origin), width: 224, icon: bootIcon(p.name, p.origin),
                                  status: usedAgo(p.lastUsed) || null, iconBoxW: ICON_BOX_W,
                                  // single font in every state -> no baseline
                                  // shift when the row becomes selected. Text
                                  // lowered to sit against the icon bottom.
                                  font: HaxrCorp4090FlipCTL, activeLabelYNudge: 0,
                                  labelYOffset: 0, rowHeight: ROW_H,
                                  suffixIcon: p.autoBoot ? ic('auto_start_heart') : null });
        });
        this.loading = false;
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        if (this.items.length) this.items[0].state = MenuLine.STATE_SELECTED;
        // Begin the auto-start countdown now that the data is in, unless a key
        // press already cancelled it while loading.
        if (this._autoStart) this._startCountdown();
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._ensureVisible = function() {
        if (this.selectedIndex < this.scrollOffset) {
            this.scrollOffset = this.selectedIndex;
        } else if (this.selectedIndex >= this.scrollOffset + VISIBLE_COUNT) {
            this.scrollOffset = this.selectedIndex - VISIBLE_COUNT + 1;
        }
    };

    BootMenuScene.prototype._flash = function(btn) {
        btn.press();
        if (window.requestRender) window.requestRender();
        setTimeout(function() {
            btn.release();
            if (window.requestRender) window.requestRender();
        }, 30);
        if (typeof btn.onPress === 'function') btn.onPress();
    };

    // Any key cancels auto-start: bar resets to empty and stops, text hides.
    BootMenuScene.prototype._cancelAutoStart = function() {
        if (!this._autoStart) return;
        this._autoStart = false;
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._openEdit = function() {
        if (!this.items.length) return;
        this._cancelAutoStart();
        this._editOpen = true;
        this._editIndex = 0;
        // Options by profile kind: _old backups get Clone + Delete; factory can't
        // be renamed or deleted (Clone / Factory Reset); users get everything.
        var p = this._profiles[this.selectedIndex] || {};
        this._editOptions = p.old
            ? ['Rename', 'Clone', 'Delete', 'Auto Start']
            : isFactory(p.name, p.origin)
                ? ['Clone', 'Factory Reset', 'Auto Start']
                : ['Rename', 'Clone', 'Factory Reset', 'Delete', 'Auto Start'];
        this._fetchSize();
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._closeEdit = function() {
        this._editOpen = false;
        this._busy = null;
        this._actionError = null;
        this._confirm = null;
        this._stopSpinner();
    };

    // Read-only Info popup (Info soft button). Reuses the size/dtbo fetch.
    BootMenuScene.prototype._openInfo = function() {
        if (!this.items.length) return;
        this._cancelAutoStart();
        this._infoOpen = true;
        this._fetchSize();   // exclusive is enough for the Info popup (no compsize)
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._closeInfo = function() {
        this._infoOpen = false;
        this._stopSpinner();
    };

    // Fetch Total + Exclusive for the selected profile; a spinner runs
    // until the response lands (results are cached server-side).
    BootMenuScene.prototype._fetchSize = function(full) {
        var p = this._profiles[this.selectedIndex] || {};
        var name = p.name || '';
        this._size = { name: name, loading: true, total: null, exclusive: null,
                       referenced: null, compression: null, dtbo: null };
        this._startSpinner();
        if (!name) { this._size.loading = false; this._stopSpinner(); return; }
        var self = this;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/boot/profile-size?name=' + encodeURIComponent(name) + (full ? '&full=1' : ''), true);
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            if (self._size.name !== name) return;   // selection moved on; ignore
            var d = {};
            try { d = JSON.parse(xhr.responseText); } catch (e) {}
            self._size = { name: name, loading: false, total: d.total || null, exclusive: d.exclusive || null,
                           referenced: d.referenced || null, compression: d.compression || null, dtbo: d.dtbo || null };
            self._stopSpinner();
            if (window.requestRender) window.requestRender();
        };
        xhr.send();
    };

    BootMenuScene.prototype._startSpinner = function() {
        var self = this;
        if (this._spinTimer) clearInterval(this._spinTimer);
        this._spinIndex = 0;
        this._spinTimer = setInterval(function() {
            self._spinIndex = (self._spinIndex + 1) % self._spinFrames.length;
            if (window.requestRender) window.requestRender();
        }, 120);
    };

    BootMenuScene.prototype._stopSpinner = function() {
        if (this._spinTimer) { clearInterval(this._spinTimer); this._spinTimer = null; }
    };

    // Input while the Edit popup is open (captures everything).
    BootMenuScene.prototype._editInput = function(action) {
        // While an action is running, swallow input; an error waits for any key.
        if (this._busy) return;
        if (this._actionError) { this._actionError = null; if (window.requestRender) window.requestRender(); return; }
        // A pending confirmation: OK proceeds, Back cancels, everything else waits.
        if (this._confirm) {
            if (action === 'ok' || action === 'run') {
                var kind = this._confirm.kind; this._confirm = null;
                if (kind === 'delete')      this._doDelete();
                else if (kind === 'reset')  this._doFactoryReset();
                return;
            }
            if (action === 'back' || action === 'esc') { this._confirm = null; if (window.requestRender) window.requestRender(); }
            return;
        }
        var opts = this._editOptions;
        if (action === 'up')        { this._editIndex = (this._editIndex - 1 + opts.length) % opts.length; }
        else if (action === 'down') { this._editIndex = (this._editIndex + 1) % opts.length; }
        else if (action === 'back' || action === 'esc') { this._closeEdit(); }
        else if (action === 'ok' || action === 'run')   { this._runEditAction(opts[this._editIndex]); return; }
        else return;
        if (window.requestRender) window.requestRender();
    };

    BootMenuScene.prototype._runEditAction = function(label) {
        var p = this._profiles[this.selectedIndex] || {};
        if (label === 'Auto Start') { this._doSetAutoStart(); return; }
        if (label === 'Rename') { this._doRename(); return; }
        if (label === 'Clone') { this._doClone(); return; }
        if (label === 'Delete') {
            this._confirm = { kind: 'delete', msg1: 'Delete this profile?', msg2: null };
        } else if (label === 'Factory Reset') {
            this._confirm = { kind: 'reset', msg1: 'Reset to factory state?',
                              msg2: p.booted ? 'Device will reboot.' : null };
        } else {
            return;   // Rename wired in a later step
        }
        if (window.requestRender) window.requestRender();
    };

    // Fire a POST action, showing `busyMsg` + spinner; onOk(data) on success,
    // otherwise the error is surfaced for a key press to dismiss.
    BootMenuScene.prototype._postAction = function(url, body, busyMsg, onOk) {
        var self = this;
        this._busy = busyMsg;
        this._startSpinner();
        if (window.requestRender) window.requestRender();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            var ok = false, err = '', data = {};
            try { data = JSON.parse(xhr.responseText); ok = data.ok; err = data.error || ''; } catch (e) { err = 'Action failed'; }
            self._busy = null; self._stopSpinner();
            if (ok) { onOk(data); }
            else    { self._actionError = String(err || 'Action failed').replace(/^Error:\s*/, ''); }
            if (window.requestRender) window.requestRender();
        };
        xhr.send(JSON.stringify(body));
    };

    // Rename: push the shared on-screen keyboard (as Wi-Fi does), seeded with
    // the current label. On Save we build @<Base>__<label>__ and POST; the popup
    // stays open underneath (enter() is guarded) to show the busy/result.
    BootMenuScene.prototype._doRename = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.name || typeof TextInputScreen === 'undefined' || !this.sceneManager) return;
        var base    = originBase(p.origin) || dispName(p.name).replace(/__.*$/, '');
        var oldName = p.name;
        // For an _old backup, keep its exact "_old_<ts>" suffix so the user can
        // keep the "(old)" flag by leaving it in the text, or drop it (promoting
        // the backup to a normal profile) by deleting it.
        var oldSuffix = '';
        if (p.old) { var mo = dispName(p.name).match(/(_old_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d)$/); oldSuffix = mo ? mo[1] : ''; }
        var taken = {};
        for (var i = 0; i < this._profiles.length; i++) taken[this._profiles[i].name] = true;
        var destOf = function(text) {
            var keepOld = false, t = String(text);
            if (p.old) { var m = t.match(/^(.*)\(old\)\s*$/i); if (m) { keepOld = true; t = m[1]; } }
            var e = encodeLabel(t);
            if (!e) return '';
            return '@' + base + '__' + e + '__' + (keepOld ? oldSuffix : '');
        };

        this._resumingFromChild = true;   // don't let enter() reset us on pop
        var screen = new TextInputScreen({
            displayName: 'Rename',
            title:       'Profile name',
            initialText: profileLabel(p.name) + (p.old ? ' (old)' : ''),
            validate: function(text) {
                var d = destOf(text);
                if (!d) return 'Name required';
                if (d !== oldName && taken[d]) return 'Name already exists';
                return '';
            },
            onSave: function(text) {
                var dest = destOf(text);
                if (!dest || dest === oldName) return;   // no change -> just close
                self._postAction('/api/boot/profile/rename', { name: oldName, dest: dest }, 'Renaming', function() {
                    self._closeEdit(); self._fetchProfiles();
                });
            }
        });
        this.sceneManager.push(screen);   // push() calls screen.enter()
    };

    BootMenuScene.prototype._doDelete = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.name) return;
        this._postAction('/api/boot/profile/delete', { name: p.name }, 'Deleting', function() {
            self._closeEdit(); self._fetchProfiles();
        });
    };

    // Make this profile the auto-boot one (flipmeta set boot <id>); the heart
    // re-reads from flipmeta on the refetch.
    BootMenuScene.prototype._doSetAutoStart = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.id) return;
        this._postAction('/api/boot/profile/autostart', { id: p.id }, 'Saving', function() {
            self._closeEdit(); self._fetchProfiles();
        });
    };

    BootMenuScene.prototype._doFactoryReset = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.name) return;
        this._postAction('/api/boot/profile/factory-reset', { name: p.name, origin: p.origin },
                         'Resetting', function(data) {
            if (data.rebooting) { self._busy = 'Rebooting'; if (window.requestRender) window.requestRender(); }
            else { self._closeEdit(); self._fetchProfiles(); }
        });
    };

    // Clone the selected profile: auto-named @<Base>__<src>-clone__ (shown "[… clone]"),
    // no prompt. On success the list refreshes with the new clone.
    BootMenuScene.prototype._buildCloneDest = function(p) {
        var base = originBase(p.origin) || dispName(p.name);
        var raw = dispName(p.name).replace(OLD_RE, '');   // clone the live copy, not the _old suffix
        var m = raw.match(/^(.+?)__(.+)__$/);
        var src = (m ? m[2] : raw).replace(/[^A-Za-z0-9-]/g, '-');
        var lbl = src + '-clone';
        var taken = {};
        for (var i = 0; i < this._profiles.length; i++) taken[this._profiles[i].name] = true;
        var cand = '@' + base + '__' + lbl + '__', n = 2;
        while (taken[cand]) { cand = '@' + base + '__' + lbl + '-' + n + '__'; n++; }
        return cand;
    };

    BootMenuScene.prototype._doClone = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.name) return;
        var dest = this._buildCloneDest(p);
        this._postAction('/api/boot/profile/clone', { source: p.name, dest: dest }, 'Cloning', function() {
            self._closeEdit(); self._fetchProfiles();
        });
    };

    BootMenuScene.prototype.handleInput = function(action) {
        if (this._editOpen) { this._editInput(action); return; }
        if (this._infoOpen) {
            // Read-only popup: any of back/esc/ok/edit closes it.
            if (action === 'back' || action === 'esc' || action === 'ok' ||
                action === 'run' || action === 'edit') { this._closeInfo(); }
            return;
        }

        this._cancelAutoStart();   // any key cancels the auto-start countdown

        if (action === 'back') return 'pop';

        // X key -> Info (read-only popup); V key -> Edit (actions popup).
        if (action === 'edit') { this._flash(this.infoBtn); this._openInfo(); return; }
        if (action === 'del')  { this._flash(this.editBtn); this._openEdit(); return; }

        var n = this.items.length;
        if (!n) return;
        if (action === 'down' || action === 'up') {
            this.items[this.selectedIndex].state = MenuLine.STATE_DEFAULT;
            this.selectedIndex = (action === 'down')
                ? (this.selectedIndex + 1) % n
                : (this.selectedIndex - 1 + n) % n;
            this.items[this.selectedIndex].state = MenuLine.STATE_SELECTED;
            this._ensureVisible();
            if (window.requestRender) window.requestRender();
        } else if (action === 'ok') {
            this._bootSelected();
        }
    };

    // Enter boots the selected profile via kexec (server runs boot-profile).
    BootMenuScene.prototype._bootSelected = function() {
        var self = this, p = this._profiles[this.selectedIndex] || {};
        if (!p.name || this._booting) return;
        this._booting = profileDisplay(p.name, p.origin);
        this._startSpinner();
        if (window.requestRender) window.requestRender();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/boot/profile/boot', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function() {
            if (xhr.readyState !== 4) return;
            var ok = false;
            try { ok = JSON.parse(xhr.responseText).ok; } catch (e) {}
            if (!ok) { self._booting = null; self._stopSpinner(); if (window.requestRender) window.requestRender(); }
            // on success the device kexecs; the page reloads when it returns.
        };
        xhr.send(JSON.stringify({ name: p.name }));
    };

    BootMenuScene.prototype.render = function(canvas) {
        var ctx = canvas.ctx;
        canvas.clear('#fff');

        // Booting: full-screen takeover with a spinner until the kexec hands over.
        if (this._booting) {
            var bF = HaxrCorp4090FlipCTL;
            var bsp = (typeof AnimatedIcons !== 'undefined') ? AnimatedIcons.spinner_22x20px : null;
            if (bsp) {
                var bfr = Math.floor(bsp.h / (bsp.frames || 1));
                var bidx = Math.floor(Date.now() / 100) % (bsp.frames || 1);
                canvas.drawSpriteFrame(bsp, Math.floor((canvas.w - bsp.w) / 2), 34, bidx, '#000');
                void bfr;
            }
            var bt = 'Booting';
            bF.draw(ctx, bt, Math.floor((canvas.w - bF.textWidth(bt)) / 2), 74, '#000');
            var bn = this._booting;
            bF.draw(ctx, bn, Math.floor((canvas.w - bF.textWidth(bn)) / 2), 88, '#000');
            return;
        }

        // Grey header background (the progress bar's black fill sweeps over it).
        canvas.drawRect(0, 0, canvas.w, HEADER_H, '#D9D9D9');

        // Header: full-width auto-start progress bar. A black fill sweeps
        // left->right over TIMEOUT_MS while counting; the header text inverts
        // to white over the fill. Once a key cancels it, the bar is empty and
        // the countdown text is gone. The "Boot Menu" title is always shown
        // (the only non-HaxrCorp text).
        // The bar/countdown only exist once the countdown has actually started
        // (after the profiles loaded) and until a key cancels it.
        var started = this._autoStart && this._startAt > 0;
        var elapsed = started ? Math.min(TIMEOUT_MS, Date.now() - this._startAt) : 0;
        var fillW   = started ? Math.round(canvas.w * (elapsed / TIMEOUT_MS)) : 0;

        var title  = 'Boot Menu';
        var titleX = Math.floor((canvas.w - Born2bSportyV2FlipCTL.textWidth(title)) / 2);
        var auto = '', autoX = 0;
        if (started) {
            var remaining = Math.max(0, Math.ceil((TIMEOUT_MS - elapsed) / 1000));
            auto  = 'Auto start in ' + remaining + 's...';
            autoX = canvas.w - 4 - HaxrCorp4090FlipCTL.textWidth(auto);
        }
        var drawHeader = function(titleColor, autoColor) {
            Born2bSportyV2FlipCTL.draw(ctx, title, titleX, 3, titleColor);
            if (auto) HaxrCorp4090FlipCTL.draw(ctx, auto, autoX, 4, autoColor);
        };
        drawHeader('#000000', '#999999');                 // base, on white
        if (fillW > 0) {
            canvas.drawRect(0, 0, fillW, HEADER_H, '#000');   // progress fill
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, fillW, HEADER_H);
            ctx.clip();
            drawHeader('#ffffff', '#ffffff');              // inverted over the fill
            ctx.restore();
        }

        if (!this.items.length) {
            var loadSpr = (typeof AnimatedIcons !== 'undefined') ? AnimatedIcons.spinner_22x20px : null;
            if (this.loading && loadSpr) {
                var frH = Math.floor(loadSpr.h / (loadSpr.frames || 1));
                var frIdx = Math.floor(Date.now() / 100) % (loadSpr.frames || 1);
                var lsx = Math.floor((canvas.w - loadSpr.w) / 2);
                var lsy = CONTAINER_Y + Math.floor((canvas.h - CONTAINER_Y - frH) / 2) - 8;
                canvas.drawSpriteFrame(loadSpr, lsx, lsy, frIdx, '#000');
            } else if (!this.loading) {
                HaxrCorp4090FlipCTL.draw(ctx, '(no profiles)', 8, CONTAINER_Y + 5, '#888888');
            }
        } else {
            var total     = this.items.length;
            var hasScroll = total > VISIBLE_COUNT;
            var selectorW = hasScroll ? SELECTOR_W_WITH_SCROLL : SELECTOR_W_NO_SCROLL;
            var dividerX  = SELECTOR_X + SELECTOR_CORNER_R;
            var dividerW  = selectorW - 2 * SELECTOR_CORNER_R;
            var lineW     = selectorW + SELECTOR_X - CONTAINER_X;
            for (var k = 0; k < this.items.length; k++) this.items[k].w = lineW;

            var first = this.scrollOffset;
            var last  = Math.min(total, first + VISIBLE_COUNT);
            var y = CONTAINER_Y, selY = CONTAINER_Y;
            for (var i = first; i < last; i++) {
                if (i === this.selectedIndex) selY = y;
                this.items[i].render(canvas, CONTAINER_X, y);
                y += ROW_H;
                if (i < last - 1) y += 1;   // 1px row spacing, no divider line
            }

            var pressed = this.items[this.selectedIndex].state === MenuLine.STATE_PRESSED;
            this.selectorFrame.setPosition(SELECTOR_X, selY + SELECTOR_Y_OFFSET);
            this.selectorFrame.setSize(selectorW, SELECTOR_H);
            this.selectorFrame.setShowFill(pressed);
            if (pressed) this.selectorFrame.setFillColor('#000');
            this.selectorFrame.render(canvas);
            if (pressed) this.items[this.selectedIndex].render(canvas, CONTAINER_X, selY);

            this.scrollbar.update(total, VISIBLE_COUNT, this.scrollOffset);
            if (this.scrollbar.shouldShow()) {
                this.scrollbar.render(canvas, SCROLLBAR_X, CONTAINER_Y, 144 - CONTAINER_Y - 16, SCROLLBAR_THUMB_PAD);
            }
        }

        // Soft buttons (dimmed while a popup is open).
        this.infoBtn.disabled = this._editOpen || this._infoOpen;
        this.editBtn.disabled = this._editOpen || this._infoOpen;
        this.infoBtn.render(canvas);
        this.editBtn.render(canvas);

        if (this._editOpen) this._renderEditPopup(canvas);
        else if (this._infoOpen) this._renderInfoPopup(canvas);
    };

    // Lazily measure the fixed size-line slot widths (number + unit).
    BootMenuScene.prototype._ensureSlots = function(F) {
        if (this._numSlotW != null) return;
        var mx = F.textWidth('00.0');
        for (var k = 0; k < this._spinFrames.length; k++) mx = Math.max(mx, F.textWidth(this._spinFrames[k]));
        this._numSlotW = mx;
        var mu = 0, u = [' B', ' KB', ' MB', ' GB'];
        for (var j = 0; j < u.length; j++) mu = Math.max(mu, F.textWidth(u[j]));
        this._unitSlotW = mu;
    };

    BootMenuScene.prototype._sizeLineWidth = function(F) {
        this._ensureSlots(F);
        return F.textWidth('Size: ') + this._numSlotW + this._unitSlotW;
    };

    // Single "Size: X" line, fixed-width slots so nothing shifts (spinner while
    // loading; number + B/KB/MB/GB unit right-aligned in their slots).
    BootMenuScene.prototype._drawSizeLine = function(canvas, fx, fw, sy) {
        var ctx = canvas.ctx, F = HaxrCorp4090FlipCTL, col = '#666666';
        this._ensureSlots(F);
        var sz = this._size, numW = this._numSlotW, unitW = this._unitSlotW;
        var lbl = 'Size: ', lblW = F.textWidth(lbl);
        var x = fx + Math.floor((fw - (lblW + numW + unitW)) / 2);
        F.draw(ctx, lbl, x, sy, col);
        var sx = x + lblW;
        var numStr, unitStr;
        if (sz.loading) { numStr = this._spinFrames[this._spinIndex]; unitStr = ' B'; }
        else { var pr = sizeParts(sz.exclusive); numStr = pr[0]; unitStr = ' ' + pr[1]; }
        var nw = F.textWidth(numStr);
        // number/spinner right-aligned in its slot (no jitter); unit sits tight
        // right after it, so a short unit like "B" isn't pushed to the right.
        // While loading, nudge the lone spinner one symbol left of the unit.
        var nx = sx + numW - nw;
        if (sz.loading) nx -= F.textWidth('0');
        F.draw(ctx, numStr, nx, sy, col);
        F.draw(ctx, unitStr, sx + numW, sy, col);
    };

    // Shared popup chrome: rounded frame + grey header band (icon + name + size
    // line). Body is drawn by the caller below HDR.
    BootMenuScene.prototype._drawPopupChrome = function(canvas, p, name, fx, fy, fw, fh, HDR) {
        var ctx = canvas.ctx;
        new ResponsiveFrame({
            x: fx, y: fy, width: fw, height: fh, anchorH: 'left', anchorV: 'top',
            strokeColor: '#000', showStroke: true, fillColor: '#fff', showFill: true, cornerRadius: 5
        }).render(canvas);
        var CR = 5;
        ctx.fillStyle = '#D9D9D9';
        for (var by = 1; by < HDR; by++) {
            var off = (by < CR) ? (CR - by) : 1;
            var left = fx + off, right = fx + fw - 1 - off;
            if (right >= left) ctx.fillRect(left, fy + by, right - left + 1, 1);
        }
        var hicon = headerIcon(p.name, p.origin);
        var nameX = fx + 8;
        if (hicon) {
            if (hicon.grayscale) canvas.drawSprite(hicon, fx + 8, fy + 6, '#000');
            else canvas.drawIcon(hicon, fx + 8, fy + 6, '#000');
            nameX = fx + 8 + hicon.w + 4;
        }
        Born2bSportyV2FlipCTL.draw(ctx, name, nameX, fy + 6, '#000');
    };

    // Fit a string into maxW px, trimming with '..' if needed.
    function fitText(F, s, maxW) {
        s = String(s);
        if (F.textWidth(s) <= maxW) return s;
        while (s.length > 1 && F.textWidth(s + '..') > maxW) s = s.slice(0, -1);
        return s + '..';
    }

    // "Last used" for the Info popup: 'now' -> Running, empty/never -> never,
    // else "X ago (YYYY-MM-DD HH:MM:SS)".
    function infoLastUsed(lu) {
        if (lu === 'now') return 'Running';
        if (!lu || lu === 'never') return 'never';
        var a = usedAgo(lu);
        var rel = a ? a.replace(/^Used /, '') : '';
        return rel ? (rel + ' (' + lu + ')') : lu;
    }

    // Edit popup: profile header (icon + name + size) over a grey band, then
    // the actions (Rename / Clone / Delete), the selected one framed.
    BootMenuScene.prototype._renderEditPopup = function(canvas) {
        var ctx = canvas.ctx;
        var p = this._profiles[this.selectedIndex] || {};
        var name = plainName(p.name, p.origin);
        var F = HaxrCorp4090FlipCTL, HDR = 38, rowH = 16;

        var sizeLineW = this._sizeLineWidth(F);
        var hicon = headerIcon(p.name, p.origin);
        var nameLineW = 8 + (hicon ? hicon.w + 4 : 0) + Born2bSportyV2FlipCTL.textWidth(name) + 8;

        // Body width + height depend on what the body currently shows.
        var bodyW = 0, bodyH;
        if (this._confirm) {
            bodyW = Math.max(F.textWidth(this._confirm.msg1),
                             this._confirm.msg2 ? F.textWidth(this._confirm.msg2) : 0,
                             F.textWidth('OK = yes    Back = no'));
            bodyH = this._confirm.msg2 ? 44 : 32;
        } else if (this._actionError) {
            bodyW = Math.max(F.textWidth(this._actionError), F.textWidth('Press any key'));
            bodyH = 32;
        } else if (this._busy) {
            bodyW = F.textWidth(this._busy + ' /');
            bodyH = 22;
        } else {
            for (var oi = 0; oi < this._editOptions.length; oi++) bodyW = Math.max(bodyW, F.textWidth(this._editOptions[oi]));
            bodyW += 28;   // room for the selector frame around the widest option
            bodyH = this._editOptions.length * rowH;
        }

        // Frame sized to the widest of header/size/body, centered on the screen.
        var fw = Math.min(252, Math.max(sizeLineW, nameLineW, bodyW) + 12);
        var fh = HDR + bodyH + 8;
        var fx = Math.round((canvas.w - fw) / 2);
        var fy = Math.round((canvas.h - fh) / 2);

        this._drawPopupChrome(canvas, p, name, fx, fy, fw, fh, HDR);
        this._drawSizeLine(canvas, fx, fw, fy + 24);

        // Confirm / busy / error take over the options area.
        if (this._confirm || this._busy || this._actionError) {
            var F2 = HaxrCorp4090FlipCTL;
            var cy = fy + HDR + Math.floor((fh - HDR) / 2) - 10;
            var self2 = this;
            var line = function(txt, yy, cc) { F2.draw(ctx, txt, fx + Math.floor((fw - F2.textWidth(txt)) / 2), yy, cc); };
            if (this._confirm) {
                line(this._confirm.msg1, cy, '#000');
                if (this._confirm.msg2) line(this._confirm.msg2, cy + 12, '#000');
                line('OK = yes    Back = no', cy + (this._confirm.msg2 ? 26 : 16), '#999999');
            } else if (this._actionError) {
                line(this._actionError, cy, '#000');
                line('Press any key', cy + 16, '#999999');
            } else {
                line(this._busy + ' ' + this._spinFrames[this._spinIndex], cy + 4, '#666666');
            }
            return;
        }

        // Actions, centred; the selected one in a rounded frame.
        var oy = fy + HDR + 5, rowH = 16;
        for (var i = 0; i < this._editOptions.length; i++) {
            var label = this._editOptions[i];
            var rowY = oy + i * rowH;
            if (i === this._editIndex) {
                this._editSelector.setPosition(fx + 10, rowY);
                this._editSelector.setSize(fw - 20, rowH);
                this._editSelector.render(canvas);
            }
            var lw = HaxrCorp4090FlipCTL.textWidth(label);
            if (label === 'Auto Start') {
                // Heart on the left ONLY when this profile is the auto-start one
                // (the heart marks the enabled state); whole group centred. Its
                // bottom aligns with the text.
                var heart = p.autoBoot ? ic('auto_start_heart') : null;
                var hw = heart ? heart.w : 0, hgap = heart ? 4 : 0;
                var gx = fx + Math.floor((fw - (hw + hgap + lw)) / 2);
                if (heart) {
                    if (heart.grayscale) canvas.drawSprite(heart, gx, rowY + 5, '#000');
                    else canvas.drawIcon(heart, gx, rowY + 5, '#000');
                }
                HaxrCorp4090FlipCTL.draw(ctx, label, gx + hw + hgap, rowY + 3, '#000');
            } else {
                HaxrCorp4090FlipCTL.draw(ctx, label, fx + Math.floor((fw - lw) / 2), rowY + 3, '#000');
            }
        }
    };

    // Info popup: same chrome as Edit, but the grey header carries all the disk
    // metrics (Total/Exclusive, then On disk + Compression), and the body below
    // is the read-only fields — Parent, Origin, Last used, DTBO (system + user).
    BootMenuScene.prototype._renderInfoPopup = function(canvas) {
        var ctx = canvas.ctx;
        var p = this._profiles[this.selectedIndex] || {};
        var name = plainName(p.name, p.origin);
        var F = HaxrCorp4090FlipCTL, HDR = 38, lineH = 11, padH = 8;

        var sz = this._size || {};
        var spin = this._spinFrames[this._spinIndex];
        var dsys, dusr;
        if (sz.loading || !sz.dtbo) { dsys = spin; dusr = spin; }
        else {
            dsys = (sz.dtbo.system && sz.dtbo.system.length) ? sz.dtbo.system.join(' ') : 'none';
            dusr = (sz.dtbo.user && sz.dtbo.user.length) ? sz.dtbo.user.join(' ') : 'none';
        }
        // drop the "(id)" suffix and the leading '@' subvol marker
        var parent  = dispName((p.parent || '-').replace(/\s*\(\d+\)\s*$/, ''));
        var factory = dispName(p.origin || '-');
        var lines = [
            'Cloned from: ' + parent,
            'Factory: ' + factory,
            'Last used: ' + infoLastUsed(p.lastUsed),
            'DTBO system: ' + dsys,
            'DTBO user: ' + dusr
        ];

        var bodyW = 0;
        for (var i = 0; i < lines.length; i++) bodyW = Math.max(bodyW, F.textWidth(lines[i]));
        var sizeLineW = this._sizeLineWidth(F);
        var hicon = headerIcon(p.name, p.origin);
        var nameLineW = 8 + (hicon ? hicon.w + 4 : 0) + Born2bSportyV2FlipCTL.textWidth(name) + 8;

        var fw = Math.min(252, Math.max(sizeLineW, nameLineW, bodyW + padH * 2) + 12);
        var fh = HDR + lines.length * lineH + 8;
        var fx = Math.round((canvas.w - fw) / 2);
        var fy = Math.round((canvas.h - fh) / 2);

        this._drawPopupChrome(canvas, p, name, fx, fy, fw, fh, HDR);
        this._drawSizeLine(canvas, fx, fw, fy + 24);   // "Size: <exclusive>"

        var ly = fy + HDR + 4;
        for (i = 0; i < lines.length; i++) {
            F.draw(ctx, fitText(F, lines[i], fw - padH * 2), fx + padH, ly, '#000');
            ly += lineH;
        }
    };

    return BootMenuScene;
})();
