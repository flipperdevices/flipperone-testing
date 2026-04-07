var Input = (function() {
    var KEY_MAP = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'Enter': 'ok',
        'Escape': 'back',
        'Backspace': 'back',
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
        'v': 'view',
        'b': 'run',
    };

    function Input() {
        this._queue = [];
        var self = this;
        document.addEventListener('keydown', function(e) {
            var action = KEY_MAP[e.key];
            if (action) {
                e.preventDefault();
                self._queue.push(action);
            }
        });
    }

    Input.prototype.processQueue = function() {
        var queue = this._queue;
        this._queue = [];
        return queue;
    };

    return Input;
})();
