(function() {
    var canvasEl = document.getElementById('screen');
    var canvas = new FlipCanvas(canvasEl);

    // Desktop-browser affordance. The Flipper's on-device browser is
    // WPE WebKit driven by cog, whose UA is "X11; Linux aarch64 ...
    // AppleWebKit ... Safari" with no Chrome/Firefox/Edge token.
    // Anything else is a developer viewing the panel on a PC, where
    // the native 256x144 is tiny, so drop it into a Flipper One photo
    // (amber-backlit) on a dark background. On the device we leave the
    // plain panel untouched.
    (function applyDesktopViewport() {
        var ua = navigator.userAgent || '';
        var isCOG = /Linux aarch64/.test(ua) && /AppleWebKit/.test(ua) &&
            !/(Chrome|Chromium|Firefox|Edg|OPR|Android|Mobile)/.test(ua);
        if (isCOG) return;
        document.documentElement.style.background = '#14171C';
        document.body.style.background = '#14171C';
        // Drop the live panel into the screen cutout of the Flipper One
        // photo. The hole is a clean 16:9 rectangle (matches 256x144)
        // at these fractions of the 2048x1080 image. Layers, low to
        // high: orange ground -> canvas (multiply -> amber backlight) ->
        // device photo on top (its transparent hole reveals the panel).
        var L = '33.94%', T = '28.89%', Wd = '28.76%', Hd = '30.65%';
        var wrap = document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.display = 'inline-block';
        wrap.style.isolation = 'isolate';
        wrap.style.lineHeight = '0';

        var bg = document.createElement('div');
        bg.style.position = 'absolute';
        bg.style.zIndex = '0';
        bg.style.left = L; bg.style.top = T; bg.style.width = Wd; bg.style.height = Hd;
        bg.style.background = '#FF8200';

        var photo = document.createElement('img');
        photo.src = 'flipper_one_front_no_screen.png';
        photo.alt = '';
        photo.style.display = 'block';
        photo.style.position = 'relative';
        photo.style.zIndex = '2';
        photo.style.width = 'auto';
        photo.style.height = 'auto';
        photo.style.maxWidth = '98vw';
        photo.style.maxHeight = '92vh';
        photo.style.pointerEvents = 'none';

        canvasEl.parentNode.insertBefore(wrap, canvasEl);
        wrap.appendChild(bg);
        wrap.appendChild(canvasEl);
        wrap.appendChild(photo);

        canvasEl.style.position = 'absolute';
        canvasEl.style.zIndex = '1';
        canvasEl.style.left = L; canvasEl.style.top = T;
        canvasEl.style.width = Wd; canvasEl.style.height = Hd;
        canvasEl.style.mixBlendMode = 'multiply';

        // Click map over the photo's physical buttons. Each region is a
        // fraction of the image; clicking injects the matching input action
        // via window.input.press/release (held while the pointer is down,
        // like the real button). Each zone shows the key it emulates.
        var HITMAP = [
            // Bottom soft-button row (left -> right): esc edit power del run.
            // Uniform size + even pitch (0.057625), anchored on the user's
            // measured first (0.3411) and last (0.5716) box.
            { a: 'esc',   l: 0.3411, t: 0.6301, w: 0.053, h: 0.053 },
            { a: 'edit',  l: 0.3987, t: 0.6301, w: 0.053, h: 0.053 },
            { a: 'power', l: 0.4564, t: 0.6301, w: 0.053, h: 0.053 },
            { a: 'del',   l: 0.5140, t: 0.6301, w: 0.053, h: 0.053 },
            { a: 'run',   l: 0.5716, t: 0.6301, w: 0.053, h: 0.053 },
            // Right orange knob: plus-shaped D-pad, symmetric about OK's
            // centre. up/ok/down share column l=0.7106; left/ok/right share
            // row t=0.399; equal arm offsets (vert 0.089, horiz 0.047).
            { a: 'up',    l: 0.7106, t: 0.3105, w: 0.045, h: 0.085 },
            { a: 'left',  l: 0.6636, t: 0.399,  w: 0.045, h: 0.086 },
            { a: 'ok',    l: 0.7106, t: 0.399,  w: 0.045, h: 0.086, round: true },
            { a: 'right', l: 0.7576, t: 0.399,  w: 0.045, h: 0.086 },
            { a: 'down',  l: 0.7106, t: 0.4885, w: 0.045, h: 0.085 },
            // App switcher (top-right corner chamfered) + Back. cutTx/cutRy
            // are the chamfer's break points (% along the top / down the right).
            { a: 'appsw', l: 0.6596, t: 0.5535, w: 0.0615, h: 0.0811, cut: 'tr', cutTx: 27, cutRy: 56 },
            { a: 'back',  l: 0.778, t: 0.5655, w: 0.0515, h: 0.0969, round: true },
            // PTT (push-to-talk, held while pressed), top-left.
            { a: 'ptt',   l: 0.2255, t: 0.1536, w: 0.071, h: 0.034 }
        ];

        // Each zone shows the keyboard key it emulates (KEY_MAP in input.js).
        var KEYLABEL = {
            esc: 'Z', edit: 'X', power: 'C', del: 'V', run: 'B',
            up: '↑', down: '↓', left: '←', right: '→', ok: 'Enter',
            appsw: 'Tab', back: 'Backspace', ptt: 'A'
        };
        var zones = [];
        HITMAP.forEach(function(r) {
            var d = document.createElement('div');
            d.style.cssText = 'position:absolute;z-index:3;box-sizing:border-box;cursor:pointer;' +
                'touch-action:none;display:flex;align-items:center;justify-content:center;';
            d.style.left = (r.l * 100) + '%';
            d.style.top = (r.t * 100) + '%';
            d.style.width = (r.w * 100) + '%';
            d.style.height = (r.h * 100) + '%';
            d.style.borderRadius = r.round ? '50%' : '4px';
            // Chamfered corner: clip-path also clips pointer hit-testing.
            if (r.cut === 'tr') {
                var tx = (r.cutTx != null) ? r.cutTx : 52;
                var ry = (r.cutRy != null) ? r.cutRy : 55;
                d.style.clipPath = 'polygon(0 0, ' + tx + '% 0, 100% ' + ry + '%, 100% 100%, 0 100%)';
            }

            var label = document.createElement('span');
            label.textContent = KEYLABEL[r.a] || r.a;
            label.style.cssText = 'pointer-events:none;font:bold 18px monospace;color:#fff;' +
                'white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,0.9);display:none;';
            d.appendChild(label);

            d.addEventListener('pointerdown', function(ev) {
                ev.preventDefault();
                if (window.input && window.input.press) window.input.press(r.a);
                if (window.requestRender) window.requestRender();
            });
            function release() { if (window.input && window.input.release) window.input.release(r.a); }
            d.addEventListener('pointerup', release);
            d.addEventListener('pointerleave', release);
            wrap.appendChild(d);
            zones.push({ el: d, label: label, round: r.round });
        });

        // Zones are invisible by default (still clickable); a checkbox
        // reveals them for reference / debugging.
        function setZonesVisible(on) {
            zones.forEach(function(z) {
                z.el.style.background = on ? 'rgba(255,130,0,0.35)' : 'transparent';
                z.el.style.border = on ? '1px solid rgba(255,255,255,0.85)' : 'none';
                z.label.style.display = on ? 'block' : 'none';
            });
        }
        setZonesVisible(false);

        var toggle = document.createElement('label');
        toggle.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10;background:#14171C;' +
            'color:#fff;font:12px sans-serif;padding:4px 8px;border-radius:5px;cursor:pointer;user-select:none;';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.verticalAlign = 'middle';
        cb.addEventListener('change', function() { setZonesVisible(cb.checked); });
        toggle.appendChild(cb);
        toggle.appendChild(document.createTextNode(' Show Controls'));
        document.body.appendChild(toggle);
    })();
    var input = new Input();
    // Exposed so scenes / modals can poll continuous held-state
    // (e.g. Wi-Fi password modal's PTT-to-reveal). The action
    // queue stays the primary delivery channel — `window.input`
    // is only for the rare features that need "is this key down
    // right now?" semantics.
    window.input = input;
    var scenes = new SceneManager();

    // Event-driven repaint: the screen only redraws when something
    // actually changed. Input always flips the flag; scenes / pollers
    // call `window.requestRender()` to trigger a repaint after they
    // mutate visible state (data arrivals, animation frames, etc.).
    var needsRender = true;

    window.requestRender = function() { needsRender = true; };

    // Resolve a human-readable name for a scene — used by the App
    // Switcher's title bars. Order of preference:
    //   1. scene.displayName  — explicit constant (e.g. DesktopScene)
    //   2. scene.breadcrumbTitle — set by SubMenuScene to its title
    //   3. empty string — bar renders without a label.
    function getSceneName(scene) {
        if (!scene) return '';
        if (typeof scene.displayName === 'string') return scene.displayName;
        if (typeof scene.breadcrumbTitle === 'string') return scene.breadcrumbTitle;
        return '';
    }

    scenes.push(new DesktopScene(scenes));

    // ── Debug-mode boot shortcut ──────────────────────────────
    // When `js/debug_config.js` is present locally and sets
    // `DEBUG_CONFIG.enabled = true`, push the named scene on
    // top of Desktop so each page refresh drops the developer
    // straight into the scene they're iterating on. The file
    // is gitignored — production loads never see this branch
    // because `typeof DEBUG_CONFIG` is `'undefined'` without
    // the local override.
    //
    // Friendly names mirror the Testing / Apps submenu labels
    // (e.g. 'On screen keyboard' → KeyboardTestScene) so the
    // string in debug_config.js reads like the navigation path
    // the developer would have taken by hand. Add entries here
    // as new debuggable scenes appear.
    if (typeof DEBUG_CONFIG !== 'undefined' && DEBUG_CONFIG.enabled) {
        var DEBUG_SCENE_MAP = {
            'On screen keyboard': function(sm) { return new KeyboardTestScene(); },
            'Touchpad':           function(sm) { return new TouchpadTestScene(); },
            'Touchpad ABS':       function(sm) { return new TouchpadAbsScene(); },
            'Network LEDs':       function(sm) { return new NetworkLedsScene(sm); },
            'Screen':             function(sm) { return new ScreenTestScene(); },
            'Voice recorder':     function(sm) { return new VoiceRecorderScene(sm); },
            'Internet radio':     function(sm) { return new InternetRadioScene(sm); },
            'Wi-Fi':              function(sm) { return new WifiScene(sm); },
            'Power menu - UI demo': function(sm) { return new PowerMenuUIDemoScene(sm); }
        };
        var debugFactory = DEBUG_SCENE_MAP[DEBUG_CONFIG.scene];
        if (typeof debugFactory === 'function') {
            var debugScene = debugFactory(scenes);
            if (debugScene && typeof debugScene.render === 'function') {
                scenes.push(debugScene);
            }
        } else if (DEBUG_CONFIG.scene) {
            // Soft-fail with a console hint so the developer
            // doesn't get a blank screen if they typo'd the
            // scene name in debug_config.js.
            // eslint-disable-next-line no-console
            console.warn('debug_config.js: unknown scene "'
                + DEBUG_CONFIG.scene + '". Known: '
                + Object.keys(DEBUG_SCENE_MAP).join(', '));
        }
    }

    // Poll the server every 2s and reload the page when the underlying
    // server changes. The signature combines HTTP status with the body id
    // so any of these triggers a reload:
    //   - same variant, new process:    "200:A" -> "200:B"
    //   - swap to a variant that lacks
    //     /api/version:                 "200:A" -> "404"
    //   - swap from such a variant:     "404"   -> "200:B"
    // fetch() rejections (server unreachable during the restart window)
    // are ignored; the next poll will pick things up.
    (function startVersionWatcher() {
        var baseline = null;
        setInterval(function() {
            fetch('/api/version', { cache: 'no-store' })
                .then(function(r) {
                    if (r.ok) {
                        return r.json().then(function(body) {
                            return r.status + ':' + body.id;
                        });
                    }
                    return String(r.status);
                })
                .then(function(sig) {
                    if (baseline === null) {
                        baseline = sig;
                    } else if (sig !== baseline) {
                        location.reload();
                    }
                })
                .catch(function() { /* server unreachable; ignore */ });
        }, 2000);
    })();

    function loop(ts) {
        var keys = input.processQueue();

        if (keys.length > 0) {
            needsRender = true;
        }

        for (var i = 0; i < keys.length; i++) {
            var active = scenes.current();
            var key = keys[i];

            // Global Tab → App Switcher overlay. Suppressed inside
            // Figma live preview because that scene runs an iframe
            // that wants Tab for its own use; everywhere else, Tab
            // toggles the switcher: closes it if it's already on
            // top, opens it otherwise.
            // Tab opens the App Switcher from anywhere except Figma
            // live preview. When the switcher is already on top, we
            // do NOT auto-pop — instead we let the action fall
            // through to AppSwitcherScene.handleInput, which now
            // treats Tab the same as OK and launches the focused app.
            //
            // If no apps are currently running, there's nothing for
            // the switcher to show, so Tab degrades into Back —
            // dispatched through the active scene's handleInput
            // (so each scene gets to decide what Back means).
            if (key === 'appsw'
                && !(active instanceof FigmaLivePreviewScene)
                && !(active instanceof AppSwitcherScene)) {

                // Capture a "transient" focused card whenever Tab is
                // pressed from a non-app scene (Desktop, Main Menu,
                // generic submenus). The switcher renders that
                // snapshot as a fade-out overlay during the intro —
                // it isn't written to RunningApps and disappears
                // when the intro completes.
                //
                // Skipped for "app-like" scenes (PlaceholderAppScene,
                // SubMenuScenes that called `markAsApp(...)` —
                // i.e. Settings / Network — and any custom scene
                // class that sets `this._isApp = true` to opt in,
                // such as InternetRadioScene). Those scenes are
                // already in RunningApps as real cards; capturing
                // a transient on top would just duplicate them
                // and trigger the slide-up-from-bottom intro
                // intended for cases where Tab opens from a
                // non-app scene.
                var isAppScene = active instanceof PlaceholderAppScene
                    || (typeof SubMenuScene !== 'undefined'
                        && active instanceof SubMenuScene
                        && active._asApp)
                    || (active && active._isApp === true);
                var transient = null;
                if (!isAppScene) {
                    var tSnap = document.createElement('canvas');
                    tSnap.width  = canvas.w;
                    tSnap.height = canvas.h;
                    tSnap.getContext('2d').drawImage(canvas.el, 0, 0);
                    transient = {
                        name: getSceneName(active) || '',
                        snapshot: tSnap
                    };
                }

                scenes.push(new AppSwitcherScene(scenes, transient));
                needsRender = true;
                continue;
            }

            if (active && active.handleInput) {
                if (active.handleInput(key) === 'pop') {
                    scenes.pop();
                    needsRender = true;
                }
            }
        }

        if (needsRender) {
            // Re-fetch the current scene — handleInput may have pushed
            // a new one (or pop above advanced the stack). Without this
            // we'd paint the previous scene and wait for its first
            // async requestRender to show the new one.
            //
            // Clear the flag *before* the scene paints. Scenes running
            // an animation call window.requestRender() from within
            // their render() to schedule the next frame; clearing
            // after would clobber that and stop the animation cold.
            var active = scenes.current();
            needsRender = false;
            canvas.clear('#000');
            if (active && active.render) {
                active.render(canvas);
                // Record the scene whose pixels are now on the canvas.
                // Scenes that snapshot themselves on exit() consult this
                // to skip captures when the visible pixels actually
                // belong to a different (e.g. overlay) scene.
                window._lastRenderedScene = active;
            }
        }

        requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
})();
