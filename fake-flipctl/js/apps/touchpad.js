var TouchpadTestScene = (function() {
    var MAX_SEGMENTS = 4096;
    var GAP_MS = 200;

    var canvasEl = null;
    var moveHandler = null;
    var leaveHandler = null;
    var enterHandler = null;
    var downHandler = null;

    var state = null;

    function freshState() {
        return {
            segments: [],
            lastTs: 0,
            lastX: -1,
            lastY: -1,
            lastSrc: null,
            cursorX: -1,
            cursorY: -1,
            cursorSrc: null,
            moves: 0,
            taps: 0
        };
    }

    function pageToCanvas(e) {
        var rect = canvasEl.getBoundingClientRect();
        var sx = canvasEl.width / rect.width;
        var sy = canvasEl.height / rect.height;
        return {
            x: Math.round((e.clientX - rect.left) * sx),
            y: Math.round((e.clientY - rect.top) * sy)
        };
    }

    function inBounds(x, y) {
        return x >= 0 && x < 256 && y >= UI.STATUS_BAR_H && y < 144;
    }

    function requestRender() {
        if (window.App && window.App.requestRender) window.App.requestRender();
    }

    function onMove(e) {
        if (!state) return;
        var p = pageToCanvas(e);
        if (!inBounds(p.x, p.y)) return;

        var src = e.pointerType || 'mouse';
        var now = e.timeStamp || performance.now();

        state.cursorX = p.x;
        state.cursorY = p.y;
        state.cursorSrc = src;
        state.moves++;

        if (state.lastTs > 0 && (now - state.lastTs) < GAP_MS && src === state.lastSrc) {
            state.segments.push({
                x0: state.lastX, y0: state.lastY,
                x1: p.x,         y1: p.y,
                src: src
            });
            if (state.segments.length > MAX_SEGMENTS) state.segments.shift();
        }

        state.lastTs = now;
        state.lastX = p.x;
        state.lastY = p.y;
        state.lastSrc = src;

        requestRender();
    }

    function onLeave() {
        if (!state) return;
        state.cursorX = -1;
        state.cursorY = -1;
        state.cursorSrc = null;
        state.lastTs = 0;
        requestRender();
    }

    function onEnter() {
        if (!state) return;
        state.lastTs = 0;
    }

    function onDown(e) {
        if (!state) return;
        state.taps++;
        state.lastTs = 0;
        requestRender();
        e.preventDefault();
    }

    function TouchpadTestScene() {}

    TouchpadTestScene.prototype.enter = function() {
        state = freshState();
        canvasEl = document.getElementById('screen');

        moveHandler = onMove;
        leaveHandler = onLeave;
        enterHandler = onEnter;
        downHandler = onDown;

        window.addEventListener('pointermove', moveHandler, { passive: true });
        window.addEventListener('pointerleave', leaveHandler, { passive: true });
        window.addEventListener('pointerenter', enterHandler, { passive: true });
        canvasEl.addEventListener('pointerdown', downHandler);
    };

    TouchpadTestScene.prototype.exit = function() {
        window.removeEventListener('pointermove', moveHandler);
        window.removeEventListener('pointerleave', leaveHandler);
        window.removeEventListener('pointerenter', enterHandler);
        if (canvasEl) canvasEl.removeEventListener('pointerdown', downHandler);
        state = null;
    };

    TouchpadTestScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';
        if (action === 'ok') {
            state.segments = [];
            state.moves = 0;
            state.taps = 0;
            state.lastTs = 0;
        }
    };

    TouchpadTestScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Touchpad Test');

        var s = state.segments;
        for (var i = 0; i < s.length; i++) {
            canvas.drawLine(s[i].x0, s[i].y0, s[i].x1, s[i].y1, '#fff');
        }

        if (state.cursorX >= 0) {
            var x = state.cursorX, y = state.cursorY;
            canvas.drawHLine(Math.max(0, x - 3), y, 7, '#fff');
            canvas.drawVLine(x, Math.max(UI.STATUS_BAR_H, y - 3), 7, '#fff');
        }

        if (s.length === 0 && state.moves === 0) {
            canvas.drawText('Move finger or mouse', 4, 18, '#888');
            canvas.drawText('OK clear  BACK exit', 4, canvas.h - 9, '#888');
        } else {
            var stat = 'm:' + state.moves + ' t:' + state.taps;
            var sw = canvas.textWidth(stat);
            canvas.drawText(stat, canvas.w - sw - 4, canvas.h - 9, '#888');
        }
    };

    return TouchpadTestScene;
})();
