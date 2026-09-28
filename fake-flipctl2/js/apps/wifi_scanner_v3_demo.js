/**
 * WifiScannerV3DemoScene
 *
 * Testing → UI Demos → 'Wi-Fi scanner v3'. Third pass at the scanner,
 * this time starting from where a user would: a copy of the main menu.
 *
 *   1. Main menu — the real MenuScene (same items, icons, first slot
 *      driven by the boot target from /api/target/current), wrapped so
 *      that only 'Apps' leads anywhere; every other row just press-
 *      flashes. 'Apps' is pre-selected so the demo is one press away.
 *   2. Apps — a SubMenuScene with the same rows and icons as the real
 *      Apps list, plus 'Wi-Fi scanner' (Icons.wi_fi_scanner) as the
 *      second row. The first row is selected on entry, like the real
 *      list. Only the scanner row opens; the rest press-flash.
 *   3. Wi-Fi scanner — an empty white screen for now (to be filled).
 *
 * Back pops one level at a time, like the real thing.
 */
var WifiScannerV3DemoScene = (function() {

    // ── 3. Scanner screen (empty for now) ────────────────────────
    function ScannerScreen(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Wi-Fi scanner';
        this.breadcrumbTitle = 'Wi-Fi scanner';
    }
    ScannerScreen.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };
    ScannerScreen.prototype.render = function(canvas) {
        canvas.clear('#fff');
    };

    // ── 2. Fake Apps list ────────────────────────────────────────
    // Same rows / icons as appsMenu() in menu.js (kept in sync by hand;
    // the registry there is private). TV Media Box lives in the main
    // menu's first slot when that target is active, so it is dropped
    // from Apps in that case — exactly like the real list.
    function appsList(sceneManager, profile) {
        var icons = {
            'Internet radio': { icon: null,
                                iconAnimated: (typeof AnimatedIcons !== 'undefined') ? AnimatedIcons.internet_radio_anim : null },
            'Voice recorder': { icon: Icons.voice_recorder, iconAnimated: null },
            'Walkie Talkie':  { icon: null,
                                iconAnimated: (typeof AnimatedIcons !== 'undefined') ? AnimatedIcons.walkie_talkie : null },
            'TV Media Box':   { icon: Icons.media, iconAnimated: null },
            'Browser':        { icon: null, iconAnimated: null },
            'Wi-Fi scanner':  { icon: Icons.wi_fi_scanner, iconAnimated: null }
        };
        var order = ['Internet radio', 'Wi-Fi scanner', 'Voice recorder', 'Walkie Talkie', 'TV Media Box', 'Browser'];
        if (profile === 'TV Media Box') {
            order = order.filter(function(n) { return n !== 'TV Media Box'; });
        }
        var subMenu = new SubMenuScene(sceneManager, 'Apps', order, {
            // Only the scanner drills in; other rows press-flash and stay.
            'Wi-Fi scanner': function() { return new ScannerScreen(sceneManager); }
        });
        // Reads "> Apps" like the real list, not "> Testing > UI Demos > …".
        subMenu.setBreadcrumbTrail(['Apps']);
        for (var i = 0; i < subMenu.items.length; i++) {
            var def = icons[subMenu.items[i].text] || {};
            subMenu.items[i].icon         = def.icon || null;
            subMenu.items[i].iconAnimated = def.iconAnimated || null;
        }
        return subMenu;
    }

    // ── 1. Fake main menu ────────────────────────────────────────
    // Wraps a real MenuScene so the look (items, icons, selector,
    // scrollbar) is the real one; input is ours: 'Apps' opens the fake
    // list, every other row only press-flashes. The inner menu is
    // rebuilt when /api/target/current answers, so the first slot
    // matches the device (TV Media Box vs Desktop Computer).
    function WifiScannerV3DemoScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Main Menu';
        this._profile = '';
        this._menu    = buildMenu(sceneManager, this._profile);
    }

    // Real MenuScene with the selection moved onto 'Apps'. The main
    // menu has no scroll at that row (index 2 of 5 visible), so only
    // the line states and the index need touching.
    function buildMenu(sceneManager, profile) {
        var menu = new MenuScene(sceneManager, profile);
        var idx  = menu.menuNames.indexOf('Apps');
        if (idx >= 0) {
            menu.items[menu.selectedIndex].state = MenuLine.STATE_DEFAULT;
            menu.selectedIndex = idx;
            menu.items[idx].state = MenuLine.STATE_SELECTED;
        }
        return menu;
    }

    WifiScannerV3DemoScene.prototype.enter = function() {
        var self = this;
        if (this._menu.enter) this._menu.enter();
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/target/current', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status !== 200) return;
            var data;
            try { data = JSON.parse(xhr.responseText); } catch (e) { return; }
            var next = (data && data.profile) ? data.profile : '';
            if (next !== self._profile) {
                self._profile = next;
                if (self._menu.exit) self._menu.exit();
                self._menu = buildMenu(self.sceneManager, next);
                if (self._menu.enter) self._menu.enter();
                if (window.requestRender) window.requestRender();
            }
        };
        try { xhr.send(); } catch (e) { /* offline — keep the default */ }
    };

    WifiScannerV3DemoScene.prototype.exit = function() {
        if (this._menu.exit) this._menu.exit();
    };

    WifiScannerV3DemoScene.prototype.handleInput = function(action) {
        var menu = this._menu;
        if (action === 'ok' || action === 'run') {
            // Same 30 ms press flash as MenuScene, then our routing.
            var self = this;
            var idx  = menu.selectedIndex;
            var line = menu.items[idx];
            line.state = MenuLine.STATE_PRESSED;
            if (window.requestRender) window.requestRender();
            setTimeout(function() {
                line.state = MenuLine.STATE_SELECTED;
                if (menu.menuNames[idx] === 'Apps' && self.sceneManager) {
                    self.sceneManager.push(appsList(self.sceneManager, self._profile));
                }
                if (window.requestRender) window.requestRender();
            }, 30);
            return;
        }
        // Up / down / back are the real menu's.
        return menu.handleInput(action);
    };

    WifiScannerV3DemoScene.prototype.render = function(canvas) {
        this._menu.render(canvas);
    };

    return WifiScannerV3DemoScene;
})();
