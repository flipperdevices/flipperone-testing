// Keyboard blinking cursor manager
// Usage:
//   var cursor = new BlinkingKeyboardCursor(500);  // 500ms blink interval
//   if (cursor.isVisible()) { drawCursor(...); }

var BlinkingKeyboardCursor = (function() {
    function BlinkingKeyboardCursor(blinkInterval) {
        this.blinkInterval = blinkInterval || 500;  // milliseconds
        this.lastTime = Date.now();
        this.visible = true;
    }

    BlinkingKeyboardCursor.prototype.update = function() {
        var now = Date.now();
        if (now - this.lastTime >= this.blinkInterval) {
            this.visible = !this.visible;
            this.lastTime = now;
        }
    };

    BlinkingKeyboardCursor.prototype.isVisible = function() {
        return this.visible;
    };

    BlinkingKeyboardCursor.prototype.reset = function() {
        this.lastTime = Date.now();
        this.visible = true;
    };

    return BlinkingKeyboardCursor;
})();
