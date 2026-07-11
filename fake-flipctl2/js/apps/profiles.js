// FlipperOS app — a thin UI over the /usr/local/sbin btrfs helpers:
//   Profiles        → GET  /api/profiles          (list-profiles)
//                     soft buttons: Default (stub) · Delete (delete-profile)
//   Snapshots       → GET  /api/snapshots         (list-snapshots)
//                     soft buttons: Delete (delete-snapshot) · Restore (create-profile)
//   Create snapshot → POST /api/snapshots/create  (create-snapshot)
//
// Entry point is ProfilesApp.makeMenu(sceneManager): it returns a
// SubMenuScene ("FlipperOS") whose rows push the scenes below.
// Registered from the Settings submenu in menu.js.
var ProfilesApp = (function() {

    // Wrap `text` into lines no wider than `maxW` px, measuring with the
    // active bitmap font. Breaks on spaces; hard-splits any single token
    // that's still too wide (btrfs paths have no spaces).
    function wrapText(canvas, text, maxW) {
        var out = [], words = String(text).split(/\s+/), line = '';
        function pushHardSplit(w) {
            var chunk = '';
            for (var i = 0; i < w.length; i++) {
                if (canvas.textWidth(chunk + w[i]) > maxW && chunk) {
                    out.push(chunk); chunk = '';
                }
                chunk += w[i];
            }
            line = chunk;
        }
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;
            var cand = line ? line + ' ' + w : w;
            if (canvas.textWidth(cand) <= maxW) {
                line = cand;
            } else {
                if (line) { out.push(line); line = ''; }
                if (canvas.textWidth(w) > maxW) pushHardSplit(w);
                else line = w;
            }
        }
        if (line) out.push(line);
        return out;
    }

    function rr() { if (window.requestRender) window.requestRender(); }

    // Centered modal box: `lines` of body text + a dim `hint` row.
    function drawModal(canvas, lines, hint) {
        var pad = 5, lh = 12;
        var boxW = canvas.w - 20, x = 10;
        var bodyLines = [];
        lines.forEach(function(l) {
            bodyLines = bodyLines.concat(wrapText(canvas, l, boxW - 2 * pad));
        });
        var rows = bodyLines.length + (hint ? 1 : 0);
        var boxH = rows * lh + 2 * pad + (hint ? 2 : 0);
        var y = Math.max(UI.STATUS_BAR_H + 2, Math.floor((144 - boxH) / 2));
        canvas.drawRect(x, y, boxW, boxH, '#fff');
        canvas.drawFrame(x, y, boxW, boxH, '#000');
        var ty = y + pad;
        bodyLines.forEach(function(l) { canvas.drawText(l, x + pad, ty, '#000'); ty += lh; });
        if (hint) canvas.drawText(hint, x + pad, y + boxH - pad - lh + 2, '#888');
    }

    // ── Generic scrollable list scene with soft buttons ──────────
    // Fetches `endpoint`, reads array `key` from the JSON, keeps the raw
    // entries, and maps each through `formatRow(entry)` to a display
    // string. `buttons` is an array of { label, action, run } — `run`
    // gets (scene, selectedEntry). Loading / error / empty are handled.
    var LIST_ITEM_H = 12;
    var BUTTON_ROW_H = 15;
    function ListScene(title, endpoint, key, formatRow, buttons) {
        this.title = title;
        this.breadcrumbTitle = title;
        this.endpoint = endpoint;
        this.key = key;
        this.formatRow = formatRow;
        this.buttonDefs = buttons || [];
        this.buttons = [];
        this.entries = [];
        this.rows = [];
        this.loading = true;
        this.error = null;
        this.sel = 0;
        this.scroll = 0;
        // dialog: null | {kind:'confirm', lines, onYes}
        //              | {kind:'notice',  lines, afterClose}
        //              | {kind:'busy',    lines}
        this.dialog = null;

        // Bottom soft buttons. On this device the physical button under
        // the X/'edit' slot is grabbed by the MCU's CPU menu, so we use
        // only the three positions the on-device testing tools use
        // (UIInput-forwarding, Power-menu demo, record):
        //   left  → 'esc' (x=0)
        //   mid   → 'del' (V slot, x=156)
        //   right → 'run' (x=208)
        var self = this;
        this.buttonDefs.forEach(function(def) {
            var btn;
            if (def.slot === 'left') {
                btn = new UI.LeftButton(def.label, 48, 'esc', null);
            } else if (def.slot === 'middle') {
                btn = new UI.MiddleButton(def.label, 0, 48, 2, 'del', null);
                btn.x = 156;
            } else {
                btn = new UI.RightButton(def.label, 48, 'run', null, 256);
            }
            btn.onPress = function() { self._fireButton(def); };
            self.buttons.push(btn);
        });
    }

    ListScene.prototype._visible = function() {
        var avail = 144 - UI.STATUS_BAR_H - 4 - (this.buttons.length ? BUTTON_ROW_H : 0);
        return Math.max(1, Math.floor(avail / LIST_ITEM_H));
    };

    ListScene.prototype.enter = function() {
        var self = this;
        this.loading = true; this.error = null;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', this.endpoint, true);
        xhr.timeout = 10000;
        function done() { self.loading = false; rr(); }
        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    var data = JSON.parse(xhr.responseText);
                    if (data.error) self.error = data.error;
                    self.entries = data[self.key] || [];
                    self.rows = self.entries.map(self.formatRow);
                    if (self.sel >= self.rows.length) self.sel = Math.max(0, self.rows.length - 1);
                    if (self.scroll > self.sel) self.scroll = 0;
                } catch (e) { self.error = 'Bad response'; }
            } else { self.error = 'HTTP ' + xhr.status; }
            done();
        };
        xhr.onerror   = function() { self.error = 'Network error'; done(); };
        xhr.ontimeout = function() { self.error = 'Timeout'; done(); };
        xhr.send();
    };
    ListScene.prototype.exit = function() {};

    // Press-flash a button, then run its action.
    ListScene.prototype._fireButton = function(def) {
        // `noEntry` actions (e.g. Create) don't operate on a row, so
        // they fire even when the list is empty. Others need a selection.
        if (def.noEntry) { def.run(this, null); return; }
        if (!this.rows.length) return;
        var entry = this.entries[this.sel];
        if (entry) def.run(this, entry);
    };

    // POST helper shared by the destructive actions. Shows a busy
    // modal, then a result notice; `refresh` re-fetches on close.
    ListScene.prototype.postAction = function(url, body, busyText, refresh) {
        var self = this;
        this.dialog = { kind: 'busy', lines: [busyText] };
        rr();
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 30000;
        function show(ok, msg) {
            self.dialog = {
                kind: 'notice',
                lines: [ok ? 'Done' : 'Error', msg],
                afterClose: refresh ? function() { self.enter(); } : null
            };
            rr();
        }
        xhr.onload = function() {
            try {
                var d = JSON.parse(xhr.responseText);
                show(!!d.ok, d.message || (d.ok ? 'OK' : 'Failed'));
            } catch (e) { show(false, 'Bad response'); }
        };
        xhr.onerror   = function() { show(false, 'Network error'); };
        xhr.ontimeout = function() { show(false, 'Timeout'); };
        xhr.send(JSON.stringify(body || {}));
    };

    ListScene.prototype.handleInput = function(action) {
        // Dialog captures all input first.
        if (this.dialog) {
            var d = this.dialog;
            if (d.kind === 'busy') return;
            if (d.kind === 'notice') {
                if (action === 'ok' || action === 'run' ||
                    action === 'back' || action === 'esc') {
                    var cb = d.afterClose; this.dialog = null;
                    if (cb) cb(); else rr();
                }
                return;
            }
            if (d.kind === 'confirm') {
                if (action === 'ok' || action === 'run') { var f = d.onYes; this.dialog = null; f(); }
                else if (action === 'back' || action === 'esc') { this.dialog = null; rr(); }
                return;
            }
            return;
        }

        // 'back' (device Back key) leaves the list; 'esc' is the
        // LEFT soft button's action (handled in the button loop below),
        // so it must NOT pop here.
        if (action === 'back') return 'pop';

        // Soft buttons.
        for (var i = 0; i < this.buttons.length; i++) {
            var btn = this.buttons[i];
            if (action === btn.action) {
                var b = btn;
                b.press(); rr();
                setTimeout(function() { b.release(); rr(); }, 30);
                if (typeof b.onPress === 'function') b.onPress();
                return;
            }
        }

        // List navigation.
        var n = this.rows.length;
        if (!n) return;
        if (action === 'down')    this.sel = (this.sel + 1) % n;
        else if (action === 'up') this.sel = (this.sel - 1 + n) % n;
        else return;
        var vis = this._visible();
        if (this.sel < this.scroll) this.scroll = this.sel;
        else if (this.sel >= this.scroll + vis) this.scroll = this.sel - vis + 1;
        rr();
    };

    ListScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        UI.drawStatusBar(canvas, this.title);
        var y = UI.STATUS_BAR_H + 3;

        if (this.loading) {
            canvas.drawText('Loading...', 4, y, '#888');
        } else if (this.error && !this.rows.length) {
            wrapText(canvas, this.error, canvas.w - 8).slice(0, 9).forEach(function(l) {
                canvas.drawText(l, 4, y, '#888'); y += LIST_ITEM_H;
            });
        } else if (!this.rows.length) {
            canvas.drawText('(none)', 4, y, '#888');
        } else {
            var vis = this._visible();
            var last = Math.min(this.rows.length, this.scroll + vis);
            for (var i = this.scroll; i < last; i++) {
                var selected = (i === this.sel);
                canvas.drawText((selected ? '> ' : '  ') + this.rows[i],
                                4, y, selected ? '#000' : '#888');
                y += LIST_ITEM_H;
            }
        }

        // Soft buttons along the bottom (drawn even while empty so the
        // affordance is visible; actions no-op with nothing selected).
        for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(canvas);

        if (this.dialog) {
            drawModal(canvas, this.dialog.lines,
                this.dialog.kind === 'confirm' ? 'OK = yes   Back = no'
                    : this.dialog.kind === 'busy' ? null
                    : 'Press OK / Back');
        }
    };

    // ── Button action definitions ────────────────────────────────
    // slot fixes the physical key: left → 'esc', middle → 'edit',
    // right → 'run'. `noEntry` actions don't need a selected row.
    var PROFILE_BUTTONS = [
        { label: 'Set Default', slot: 'left', run: function(scene, entry) {
            // Set Default: concept-only stub (no set-default script yet).
            scene.dialog = {
                kind: 'notice',
                lines: ['Set Default', 'Not implemented (concept).'],
                afterClose: null
            };
            rr();
        } },
        { label: 'Delete', slot: 'right', run: function(scene, entry) {
            // A _stock profile is a golden factory-reset base — deleting
            // it is extra-destructive, so require a SECOND confirmation
            // (mirrors delete-profile's own tiered confirm).
            var isStock = entry.kind === 'stock' || /_stock$/.test(entry.name);
            function doDelete() {
                scene.postAction('/api/profiles/delete', { name: entry.name },
                    'Deleting...', true);
            }
            function secondConfirm() {
                scene.dialog = {
                    kind: 'confirm',
                    lines: [entry.name, 'is a _stock golden base',
                            '(factory-reset source).', 'Delete anyway?'],
                    onYes: doDelete
                };
                rr();
            }
            scene.dialog = {
                kind: 'confirm',
                lines: ['Delete profile', entry.name + '?'],
                onYes: isStock ? secondConfirm : doDelete
            };
            rr();
        } }
    ];

    // Order left → right: Restore (left/esc), Delete (middle/edit),
    // Create (right/run).
    var SNAPSHOT_BUTTONS = [
        { label: 'Restore', slot: 'left', run: function(scene, entry) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Restore onto booted profile?', entry.name,
                        '(takes effect after reboot)'],
                onYes: function() {
                    scene.postAction('/api/snapshots/restore', { name: entry.name },
                        'Restoring...', false);
                }
            };
            rr();
        } },
        { label: 'Delete', slot: 'middle', run: function(scene, entry) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Delete snapshot', entry.name + '?'],
                onYes: function() {
                    scene.postAction('/api/snapshots/delete', { name: entry.name },
                        'Deleting...', true);
                }
            };
            rr();
        } },
        { label: 'Create', slot: 'right', noEntry: true, run: function(scene) {
            scene.dialog = {
                kind: 'confirm',
                lines: ['Create snapshot of the booted root?'],
                onYes: function() {
                    scene.postAction('/api/snapshots/create', {}, 'Creating...', true);
                }
            };
            rr();
        } }
    ];

    // ── Menu factory ─────────────────────────────────────────────
    function makeMenu(sceneManager) {
        return new SubMenuScene(sceneManager, 'FlipperOS',
            ['Profiles', 'Snapshots'],
            {
                'Profiles': function() {
                    return new ListScene('Profiles', '/api/profiles', 'profiles',
                        function(p) {
                            return p.name + (p.booted ? ' *' : '') +
                                   (p.kind ? '  [' + p.kind + ']' : '');
                        }, PROFILE_BUTTONS);
                },
                'Snapshots': function() {
                    return new ListScene('Snapshots', '/api/snapshots', 'snapshots',
                        function(s) { return s.name; }, SNAPSHOT_BUTTONS);
                }
            });
    }

    return { makeMenu: makeMenu };
})();
