/**
 * VoiceAssistantScene
 *
 * Push-to-talk voice assistant. Hold the PTT hardware button (KEY_A →
 * 'ptt' action) to record; release to send the clip to Groq. The edge
 * of the held state (idle→held / held→idle) drives the flow, polled the
 * same way Walkie Talkie reads the PTT switch (`Input.isHeld('ptt')`).
 *
 * Backend: POST /api/voice/start begins arecord; POST /api/voice/stop
 * finalizes the WAV and runs scripts/groq_voice.py (Whisper transcription
 * + a chat reply), returning { ok, transcript, reply }.
 */
var VoiceAssistantScene = (function() {
    var POLL_MS = 60;

    function VoiceAssistantScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'Voice Assistant';
        this.breadcrumbTitle = 'Voice Assistant';

        // idle | listening | thinking | result | error
        // Same icon as Voice recorder (14x14 grayscale sprite).
        this.icon = (typeof Icons !== 'undefined' && Icons.voice_recorder)
            ? Icons.voice_recorder : null;

        this.state      = 'idle';
        this.transcript = '';
        this.reply      = '';
        this.error      = '';

        this._held  = false;   // last observed PTT state (for edge detection)
        this._busy  = false;   // a start/stop request is in flight
        this._timer = null;
        this._level = 0;       // 0..100 mic peak, polled while listening
        this._levelInflight = false;
        this._scroll = 0;      // result/error vertical scroll offset (lines)
        this._maxScroll = 0;   // set each render from content height
        this._streaming = false; // reply still arriving -> auto-follow the bottom
    }

    VoiceAssistantScene.prototype.enter = function() {
        var self = this;
        this._held = false;
        // The OK press that launched this app is likely still held; don't arm
        // recording until PTT/OK has been released at least once.
        this._armed = false;
        this._timer = setInterval(function() { self._poll(); }, POLL_MS);
    };

    VoiceAssistantScene.prototype.exit = function() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        // If we bail out mid-capture, tell the server to stop arecord so it
        // doesn't keep holding the mic. Fire-and-forget.
        if (this.state === 'listening') {
            try { fetch('/api/voice/stop', { method: 'POST' }); } catch (e) {}
        }
    };

    // Edge-detect the PTT switch.
    VoiceAssistantScene.prototype._poll = function() {
        var input = window.input;
        var canHold = !!(input && typeof input.isHeld === 'function');
        // The OK / center (Enter) button works exactly like PTT: hold to
        // record, release to send.
        var held = canHold && (input.isHeld('ptt') || input.isHeld('ok'));
        // Swallow the launch keypress: wait for a release before arming, so
        // the OK that opened the app doesn't immediately start recording.
        if (!this._armed) {
            if (!held) this._armed = true;
            this._held = held;
            return;
        }
        if (held !== this._held) {
            this._held = held;
            if (held) this._onPress(); else this._onRelease();
        }
        // Live mic level for the VU meter while capturing.
        if (this.state === 'listening') this._pollLevel();
    };

    VoiceAssistantScene.prototype._pollLevel = function() {
        if (this._levelInflight) return;
        this._levelInflight = true;
        var self = this;
        fetch('/api/voice/level')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                self._levelInflight = false;
                self._level = (d && typeof d.level === 'number') ? d.level : 0;
                if (self.state === 'listening') self._render();
            })
            .catch(function() { self._levelInflight = false; });
    };

    VoiceAssistantScene.prototype._onPress = function() {
        // Only start a fresh capture from a settled state.
        if (this._busy || this.state === 'listening' || this.state === 'thinking') return;
        this._busy = true;
        this.transcript = ''; this.reply = ''; this.error = '';
        this.state = 'listening';
        this._render();

        var self = this;
        fetch('/api/voice/start', { method: 'POST' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                self._busy = false;
                if (!d || !d.ok) self._fail((d && d.error) || 'recording failed');
            })
            .catch(function() { self._busy = false; self._fail('recording failed'); });
    };

    VoiceAssistantScene.prototype._onRelease = function() {
        if (this.state !== 'listening') return;
        this.state = 'thinking';
        this.transcript = ''; this.reply = ''; this.error = '';
        this._scroll = 0;
        this._streaming = true;   // auto-follow the reply as it streams in
        this._render();

        var self = this;
        fetch('/api/voice/stop', { method: 'POST' })
            .then(function(resp) {
                if (!resp.ok && resp.status !== 200) { self._fail('HTTP ' + resp.status); return; }
                // Stream the newline-delimited JSON events as they arrive so the
                // reply renders token-by-token. Fall back to a single read if the
                // browser can't stream the body.
                if (!resp.body || !resp.body.getReader) {
                    resp.text().then(function(t) { self._consume(t, true); });
                    return;
                }
                var reader = resp.body.getReader();
                var dec = new TextDecoder();
                var buf = '';
                function pump() {
                    reader.read().then(function(r) {
                        if (r.done) { self._consume(buf, true); self._streamDone(); return; }
                        buf += dec.decode(r.value, { stream: true });
                        var nl;
                        while ((nl = buf.indexOf('\n')) >= 0) {
                            self._event(buf.slice(0, nl));
                            buf = buf.slice(nl + 1);
                        }
                        pump();
                    }).catch(function() { self._fail('stream error'); });
                }
                pump();
            })
            .catch(function() { self._fail('request failed'); });
    };

    // Handle any trailing buffered text (called on stream end); `flushAll`
    // parses whatever is left even without a trailing newline.
    VoiceAssistantScene.prototype._consume = function(text, flushAll) {
        if (!text) return;
        var parts = String(text).split('\n');
        var self = this;
        parts.forEach(function(line) { if (flushAll || line) self._event(line); });
    };

    // Apply one NDJSON event line to the state.
    VoiceAssistantScene.prototype._event = function(line) {
        line = String(line).trim();
        if (!line) return;
        var ev;
        try { ev = JSON.parse(line); } catch (e) { return; }
        if (ev.type === 'transcript') {
            this.transcript = ev.text || '';
            this.state = 'result';
        } else if (ev.type === 'delta') {
            this.reply += ev.text || '';
            this.state = 'result';
        } else if (ev.type === 'error') {
            // A mid-reply chat error keeps what we have; otherwise it's fatal.
            if (this.reply || this.transcript) { this.error = ev.error || 'error'; this.state = 'result'; }
            else { this.error = ev.error || 'error'; this.state = 'error'; }
            this._streaming = false;
        } else if (ev.type === 'done') {
            this.state = 'result';
            this._streaming = false;
        } else if (ev.ok === false) {
            this.error = ev.error || 'error';
            this.state = 'error';
            this._streaming = false;
        } else if (ev.ok === true) {
            // batch fallback (non-stream server)
            this.transcript = ev.transcript || '';
            this.reply = ev.reply || '';
            if (ev.error) this.error = ev.error;
            this.state = 'result';
        }
        this._render();
    };

    VoiceAssistantScene.prototype._streamDone = function() {
        if (this.state === 'thinking') this.state = 'result';
        this._streaming = false;
        this._render();
    };

    VoiceAssistantScene.prototype._fail = function(msg) {
        this.error = msg;
        this.state = 'error';
        this._streaming = false;
        this._render();
    };

    VoiceAssistantScene.prototype._render = function() {
        if (window.requestRender) window.requestRender();
    };

    VoiceAssistantScene.prototype.handleInput = function(action) {
        // PTT / OK are handled by the held-state poll; ignore the discrete tap.
        if (action === 'back' || action === 'esc') {
            if (this.state === 'listening') return;   // finish the clip first
            return 'pop';
        }
        // Vertical scrolling through a long transcript / reply. Manual scroll
        // takes over from the streaming auto-follow.
        if (this.state === 'result' || this.state === 'error') {
            if (action === 'down') {
                this._streaming = false;
                this._scroll = Math.min(this._maxScroll, this._scroll + 1);
                this._render();
            } else if (action === 'up') {
                this._streaming = false;
                this._scroll = Math.max(0, this._scroll - 1);
                this._render();
            }
        }
    };

    // Body text uses the same pixel font as the recorder's rows.
    function H(ctx, text, x, y, color) {
        HaxrCorp4090FlipCTL.draw(ctx, text, x, y, color || '#000');
    }
    function wrapH(text, maxW) {
        var out = [], words = String(text).split(/\s+/), line = '';
        for (var i = 0; i < words.length; i++) {
            var w = words[i];
            if (!w) continue;
            var cand = line ? line + ' ' + w : w;
            if (HaxrCorp4090FlipCTL.textWidth(cand) <= maxW) {
                line = cand;
            } else {
                if (line) out.push(line);
                line = w;
            }
        }
        if (line) out.push(line);
        return out;
    }

    // VU meter, mirroring the recorder's "Input level" row: a left label,
    // an outlined bar on the right, filled black proportional to `level`.
    function drawMeter(canvas, level, y) {
        var BAR_W = 180, BAR_H = 7, BAR_R = 2;
        var BAR_X = canvas.w - 5 - BAR_W;
        H(canvas.ctx, 'Level', 6, y, '#000');
        new ResponsiveFrame({
            x: BAR_X, y: y + 1, width: BAR_W, height: BAR_H,
            anchorH: 'left', anchorV: 'top',
            showFill: false, showStroke: true, strokeColor: '#000', cornerRadius: BAR_R
        }).render(canvas);
        var lvl = Math.max(0, Math.min(100, level));
        if (lvl > 0) {
            var fillW = Math.round(BAR_W * lvl / 100);
            var isFull = fillW >= BAR_W;
            new ResponsiveFrame({
                x: BAR_X, y: y + 1, width: fillW, height: BAR_H,
                anchorH: 'left', anchorV: 'top',
                showStroke: false, showFill: true, fillColor: '#000', cornerRadius: BAR_R,
                corners: { tl: true, bl: true, tr: isFull, br: isFull }
            }).render(canvas);
        }
    }

    // Flatten result/error content into scrollable lines. Each line is an
    // array of segments { text, x, bold }. "You:"/"AI:" are bold and sit
    // INLINE with their text, aligned to a common text column.
    function buildLines(self, maxW) {
        var lines = [];
        if (self.state === 'error') {
            lines.push([{ text: 'Error', x: 6, bold: true }]);
            wrapH(self.error, maxW).forEach(function(t) { lines.push([{ text: t, x: 6 }]); });
            return lines;
        }
        var lw = Math.max(Born2bSportyV2FlipCTL.textWidth('You: '),
                          Born2bSportyV2FlipCTL.textWidth('AI: '));
        var textX = 6 + lw;
        var tw = maxW - lw;
        function block(label, text) {
            var ws = wrapH(text, tw);
            if (!ws.length) ws = [''];
            ws.forEach(function(t, i) {
                if (i === 0) lines.push([{ text: label, x: 6, bold: true }, { text: t, x: textX }]);
                else lines.push([{ text: t, x: textX }]);
            });
        }
        block('You:', self.transcript || '(nothing heard)');
        lines.push([]);   // spacer
        if (self.reply) block('AI:', self.reply);
        else if (self.error) wrapH(self.error, tw).forEach(function(t) { lines.push([{ text: t, x: textX }]); });
        return lines;
    }

    var TITLE_H = 16, TITLE_FILL = '#D9D9D9';

    VoiceAssistantScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;

        // (1) Status bar — empty title; the gray app-title strip carries the name.
        UI.drawStatusBar(canvas, '');
        // (2) App-title header: full-width gray strip flush under the status bar.
        var titleY = UI.STATUS_BAR_H;
        ctx.fillStyle = TITLE_FILL;
        ctx.fillRect(0, titleY, canvas.w, TITLE_H);
        // (3) Icon (same 14x14 sprite as Voice recorder) + (4) title (heavy font).
        if (this.icon) canvas.drawSprite(this.icon, 2, titleY + 1, '#000');
        Born2bSportyV2FlipCTL.draw(ctx, 'Voice Assistant', 18, UI.STATUS_BAR_H + 1, '#000');

        var y = titleY + TITLE_H + 6;   // first body line, below the strip
        var LH = 11;
        var maxW = canvas.w - 12;

        if (this.state === 'idle') {
            H(ctx, 'Hold PTT button and speak', 6, y);
            H(ctx, 'Release to send.', 6, y + 1 * LH, '#888');
        } else if (this.state === 'listening') {
            H(ctx, 'Listening...', 6, y);
            drawMeter(canvas, this._level, y + LH + 3);
            H(ctx, 'release to send', 6, y + 2 * LH + 14, '#888');
        } else if (this.state === 'thinking') {
            H(ctx, 'Thinking...', 6, y);
        } else { // result or error — scrollable, inline bold labels
            var lines = buildLines(this, maxW);
            var vis = Math.max(1, Math.floor((canvas.h - y) / LH));
            this._maxScroll = Math.max(0, lines.length - vis);
            if (this._streaming) this._scroll = this._maxScroll;   // follow the bottom
            if (this._scroll > this._maxScroll) this._scroll = this._maxScroll;
            if (this._scroll < 0) this._scroll = 0;
            var start = this._scroll;
            var end = Math.min(lines.length, start + vis);
            var yy = y;
            for (var li = start; li < end; li++) {
                var segs = lines[li];
                for (var si = 0; si < segs.length; si++) {
                    var s = segs[si];
                    // Born2b's baseline sits 4px lower than HaxrCorp's, so lift
                    // the bold label to share the text's baseline on the line.
                    if (s.bold) Born2bSportyV2FlipCTL.draw(ctx, s.text, s.x, yy - 4, '#000');
                    else H(ctx, s.text, s.x, yy, '#000');
                }
                yy += LH;
            }
            // Scroll affordances.
            if (start > 0) H(ctx, '^', canvas.w - 8, y, '#888');
            if (end < lines.length) H(ctx, 'v', canvas.w - 8, canvas.h - LH, '#888');
        }
    };

    return VoiceAssistantScene;
})();
