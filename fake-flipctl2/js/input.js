var Input = (function() {
    var KEY_MAP = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'Enter': 'ok',
        'Escape': 'back',
        'Backspace': 'back',
        'Tab': 'appsw',
        'k': 'ok',
        'i': 'up',
        'm': 'down',
        'j': 'left',
        'l': 'right',
        'h': 'appsw',
        'n': 'back',
        'a': 'ptt',
        'z': 'esc',
        'x': 'edit',
        'c': 'power',
        'v': 'del',
        'b': 'run',
    };

    function Input() {
        this._queue = [];
        // `_held` mirrors which mapped actions currently have
        // their key down. Used by push-to-reveal style features
        // (e.g. the Wi-Fi password modal) that need continuous
        // state instead of a one-shot action. The browser
        // delivers auto-repeat keydown events while a key is
        // held, so this map flips back to false ONLY on keyup.
        this._held = {};
        var self = this;
        document.addEventListener('keydown', function(e) {
            var action = KEY_MAP[e.key];
            if (action) {
                e.preventDefault();
                self._queue.push(action);
                self._held[action] = true;
            }
        });
        document.addEventListener('keyup', function(e) {
            var action = KEY_MAP[e.key];
            if (action) {
                self._held[action] = false;
            }
        });
        // Window-blur safety net: if the user Alt-Tabs while
        // holding a key, the browser may swallow the keyup. Reset
        // every held flag so push-to-reveal doesn't get stuck on.
        window.addEventListener('blur', function() {
            self._held = {};
        });
    }

    Input.prototype.processQueue = function() {
        var queue = this._queue;
        this._queue = [];
        return queue;
    };

    Input.prototype.isHeld = function(action) {
        return !!this._held[action];
    };

    // Inject an action programmatically (e.g. the on-screen click map
    // over the Flipper photo). press() queues the action and marks it
    // held; release() clears the held flag. Same semantics as a
    // key down / key up on the matching physical button.
    Input.prototype.press = function(action) {
        if (!action) return;
        this._queue.push(action);
        this._held[action] = true;
    };
    Input.prototype.release = function(action) {
        if (action) this._held[action] = false;
    };

    return Input;
})();
