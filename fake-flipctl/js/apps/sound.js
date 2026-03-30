// Sound menu: Play sound, Audio devices, Restart audio driver

var SoundMenuScene = (function() {
    function SoundMenuScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.items = ['Play sound', 'Change volume', 'Audio devices', 'Restart audio driver'];
        this.selectedIndex = 0;
        this.scrollOffset = 0;
        this.appScenes = {
            'Play sound': function() { return new PlaySoundScene(); },
            'Change volume': function() { return new VolumeScene(); },
            'Audio devices': function() { return new AudioDevicesScene(); },
            'Restart audio driver': function() { return new RestartDriverScene(); }
        };
    }

    SoundMenuScene.prototype.enter = function() {};
    SoundMenuScene.prototype.exit = function() {};

    SoundMenuScene.prototype.handleInput = function(action) {
        var visible = UI.visibleCount(144);
        if (action === 'down') {
            if (this.selectedIndex < this.items.length - 1) {
                this.selectedIndex++;
                if (this.selectedIndex >= this.scrollOffset + visible)
                    this.scrollOffset = this.selectedIndex - visible + 1;
            }
        } else if (action === 'up') {
            if (this.selectedIndex > 0) {
                this.selectedIndex--;
                if (this.selectedIndex < this.scrollOffset)
                    this.scrollOffset = this.selectedIndex;
            }
        } else if (action === 'ok') {
            var factory = this.appScenes[this.items[this.selectedIndex]];
            if (factory) this.sceneManager.push(factory());
        } else if (action === 'back') {
            return 'pop';
        }
    };

    SoundMenuScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Sound');
        UI.drawMenuList(canvas, this.items, this.selectedIndex, this.scrollOffset);
    };

    return SoundMenuScene;
})();


var PlaySoundScene = (function() {
    var files = [];
    var loading = true;
    var error = false;
    var selectedIndex = 0;
    var scrollOffset = 0;
    var playing = null; // filename currently playing

    function fetchFiles() {
        loading = true;
        error = false;
        files = [];
        selectedIndex = 0;
        scrollOffset = 0;
        playing = null;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/sound/files', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                files = JSON.parse(xhr.responseText).files || [];
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function playFile(filename) {
        playing = filename;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/play', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.onload = function() {
            playing = null;
        };
        xhr.onerror = function() { playing = null; };
        xhr.ontimeout = function() { playing = null; };
        xhr.send(JSON.stringify({ file: filename }));
    }

    function stopPlayback() {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/stop', true);
        xhr.timeout = 3000;
        xhr.onload = function() { playing = null; };
        xhr.onerror = function() { playing = null; };
        xhr.send();
    }

    function PlaySoundScene() {}

    PlaySoundScene.prototype.enter = function() { fetchFiles(); };
    PlaySoundScene.prototype.exit = function() {
        if (playing) stopPlayback();
    };

    PlaySoundScene.prototype.handleInput = function(action) {
        if (loading) return;

        var visible = UI.visibleCount(144);

        if (action === 'down') {
            if (selectedIndex < files.length - 1) {
                selectedIndex++;
                if (selectedIndex >= scrollOffset + visible)
                    scrollOffset = selectedIndex - visible + 1;
            }
        } else if (action === 'up') {
            if (selectedIndex > 0) {
                selectedIndex--;
                if (selectedIndex < scrollOffset)
                    scrollOffset = selectedIndex;
            }
        } else if (action === 'ok') {
            if (files.length > 0) {
                if (playing === files[selectedIndex]) {
                    stopPlayback();
                } else {
                    playFile(files[selectedIndex]);
                }
            }
        } else if (action === 'back') {
            return 'pop';
        }
    };

    PlaySoundScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Play sound');

        if (loading) {
            canvas.drawText('Loading...', 4, UI.STATUS_BAR_H + 4, '#888');
            return;
        }
        if (error) {
            canvas.drawText('Error loading files', 4, UI.STATUS_BAR_H + 4, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }
        if (files.length === 0) {
            canvas.drawText('No audio files', 4, UI.STATUS_BAR_H + 4, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // Build display names with playing indicator
        var displayItems = [];
        for (var i = 0; i < files.length; i++) {
            var name = files[i].replace(/\.(wav|flac|ogg|aiff?|mp3|au|snd|caf|w64|wv|amr|voc|sph|xi)$/i, '');
            if (playing === files[i]) name = name + ' >>>';
            displayItems.push(name);
        }

        UI.drawMenuList(canvas, displayItems, selectedIndex, scrollOffset);
    };

    return PlaySoundScene;
})();


var AudioDevicesScene = (function() {
    var devices = [];
    var loading = true;
    var error = false;
    var selectedIndex = 0;
    var scrollOffset = 0;
    var activeDevice = null;

    function fetchDevices() {
        loading = true;
        error = false;
        devices = [];
        selectedIndex = 0;
        scrollOffset = 0;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/sound/devices', true);
        xhr.timeout = 5000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                devices = data.devices || [];
                activeDevice = data.defaultDevice || null;
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function setDevice(deviceName) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/device', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                activeDevice = deviceName;
            }
        };
        xhr.send(JSON.stringify({ device: deviceName }));
    }

    function AudioDevicesScene() {}

    AudioDevicesScene.prototype.enter = function() { fetchDevices(); };
    AudioDevicesScene.prototype.exit = function() {};

    AudioDevicesScene.prototype.handleInput = function(action) {
        if (loading) return;

        var visible = UI.visibleCount(144);

        if (action === 'down') {
            if (selectedIndex < devices.length - 1) {
                selectedIndex++;
                if (selectedIndex >= scrollOffset + visible)
                    scrollOffset = selectedIndex - visible + 1;
            }
        } else if (action === 'up') {
            if (selectedIndex > 0) {
                selectedIndex--;
                if (selectedIndex < scrollOffset)
                    scrollOffset = selectedIndex;
            }
        } else if (action === 'ok') {
            if (devices.length > 0) {
                setDevice(devices[selectedIndex].name);
            }
        } else if (action === 'back') {
            return 'pop';
        }
    };

    AudioDevicesScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Audio devices');

        if (loading) {
            canvas.drawText('Loading...', 4, UI.STATUS_BAR_H + 4, '#888');
            return;
        }
        if (error) {
            canvas.drawText('Error reading devices', 4, UI.STATUS_BAR_H + 4, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }
        if (devices.length === 0) {
            canvas.drawText('No audio devices', 4, UI.STATUS_BAR_H + 4, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        var displayItems = [];
        for (var i = 0; i < devices.length; i++) {
            var d = devices[i];
            var label = d.description || d.name;
            // Truncate long names
            if (label.length > 36) label = label.substring(0, 34) + '..';
            if (d.name === activeDevice) label = '*' + label;
            displayItems.push(label);
        }

        UI.drawMenuList(canvas, displayItems, selectedIndex, scrollOffset);
    };

    return AudioDevicesScene;
})();


var VolumeScene = (function() {
    var controls = [
        { name: 'Speaker', label: 'Speaker', volume: 0 },
        { name: 'Headphone', label: 'Headphone', volume: 0 }
    ];
    var selectedControl = 0;
    var loading = true;
    var error = false;
    var step = 5;
    var pending = false;

    function fetchVolume() {
        loading = true;
        error = false;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/sound/volume', true);
        xhr.timeout = 3000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                if (data.speaker !== null) controls[0].volume = data.speaker;
                if (data.headphone !== null) controls[1].volume = data.headphone;
            } else {
                error = true;
            }
            loading = false;
        };
        xhr.onerror = function() { error = true; loading = false; };
        xhr.ontimeout = function() { error = true; loading = false; };
        xhr.send();
    }

    function sendVolume(control, val) {
        if (pending) return;
        pending = true;
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/volume', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 3000;
        xhr.onload = function() { pending = false; };
        xhr.onerror = function() { pending = false; };
        xhr.ontimeout = function() { pending = false; };
        xhr.send(JSON.stringify({ control: control, volume: val }));
    }

    function VolumeScene() {}

    VolumeScene.prototype.enter = function() { fetchVolume(); };
    VolumeScene.prototype.exit = function() {};

    VolumeScene.prototype.handleInput = function(action) {
        if (loading) return;

        var c = controls[selectedControl];
        if (action === 'right') {
            c.volume = Math.min(100, c.volume + step);
            sendVolume(c.name, c.volume);
        } else if (action === 'left') {
            c.volume = Math.max(0, c.volume - step);
            sendVolume(c.name, c.volume);
        } else if (action === 'down') {
            if (selectedControl < controls.length - 1) selectedControl++;
        } else if (action === 'up') {
            if (selectedControl > 0) selectedControl--;
        } else if (action === 'back') {
            return 'pop';
        }
    };

    VolumeScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Volume');

        var y = UI.STATUS_BAR_H + 4;

        if (loading) {
            canvas.drawText('Loading...', 4, y, '#888');
            return;
        }
        if (error) {
            canvas.drawText('Error reading volume', 4, y, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        var barW = canvas.w - 12;
        var barH = 5;
        var blockH = 30;

        for (var i = 0; i < controls.length; i++) {
            var c = controls[i];
            var cy = y + i * blockH;
            var selected = (i === selectedControl);
            var textColor = selected ? '#fff' : '#888';
            var prefix = selected ? '>' : ' ';

            canvas.drawText(prefix + c.label + ': ' + c.volume + '%', 4, cy, textColor);

            var barY = cy + 10;
            canvas.drawFrame(4, barY, barW + 2, barH + 2, selected ? '#fff' : '#888');
            var fillW = Math.round(barW * (c.volume / 100));
            if (fillW > 0) {
                canvas.drawRect(5, barY + 1, fillW, barH, selected ? '#fff' : '#888');
            }
        }

        canvas.drawText('</>  Adjust    ^/v  Select', 4, canvas.h - 20, '#888');
        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return VolumeScene;
})();


var RestartDriverScene = (function() {
    // States: 'confirm', 'running', 'success', 'fail'
    var state = 'confirm';
    var output = '';
    var buttonIndex = 0;

    function runRestart() {
        state = 'running';
        output = '';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/sound/restart-driver', true);
        xhr.timeout = 15000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                output = data.output || '';
                state = data.success ? 'success' : 'fail';
            } else {
                output = 'HTTP ' + xhr.status;
                state = 'fail';
            }
        };
        xhr.onerror = function() { output = 'Network error'; state = 'fail'; };
        xhr.ontimeout = function() { output = 'Timeout'; state = 'fail'; };
        xhr.send();
    }

    function RestartDriverScene() {}

    RestartDriverScene.prototype.enter = function() {
        state = 'confirm';
        output = '';
        buttonIndex = 0;
    };
    RestartDriverScene.prototype.exit = function() {};

    RestartDriverScene.prototype.handleInput = function(action) {
        if (state === 'running') return;

        if (state === 'confirm') {
            if (action === 'left' || action === 'right') {
                buttonIndex = buttonIndex === 0 ? 1 : 0;
            } else if (action === 'ok') {
                if (buttonIndex === 0) {
                    runRestart();
                } else {
                    return 'pop';
                }
            } else if (action === 'back') {
                return 'pop';
            }
            return;
        }

        if (action === 'back' || action === 'ok') return 'pop';
    };

    RestartDriverScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Restart driver');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        if (state === 'confirm') {
            canvas.drawText('Restart NAU8822 audio', 4, y, '#fff');
            canvas.drawText('driver? This will', 4, y + lineH, '#fff');
            canvas.drawText('unbind and rebind the', 4, y + lineH * 2, '#fff');
            canvas.drawText('I2C codec driver.', 4, y + lineH * 3, '#fff');

            var btnY = canvas.h - 11;
            var restartLabel = '[Restart]';
            var cancelLabel = '[Cancel]';
            if (buttonIndex === 0) {
                canvas.drawText(restartLabel, 4, btnY, '#fff');
                canvas.drawText(cancelLabel, 4 + restartLabel.length * 6 + 12, btnY, '#888');
            } else {
                canvas.drawText(restartLabel, 4, btnY, '#888');
                canvas.drawText(cancelLabel, 4 + restartLabel.length * 6 + 12, btnY, '#fff');
            }
            return;
        }

        if (state === 'running') {
            canvas.drawText('Restarting driver...', 4, y, '#fff');
            canvas.drawText('Please wait', 4, y + lineH, '#888');
            return;
        }

        if (state === 'success') {
            canvas.drawText('Driver restarted', 4, y, '#fff');
            canvas.drawText('NAU8822 recovered', 4, y + lineH, '#fff');
            // Show truncated output
            if (output) {
                var lines = output.split('\n');
                for (var i = 0; i < lines.length && i < 5; i++) {
                    var line = lines[i];
                    if (line.length > 42) line = line.substring(0, 40) + '..';
                    canvas.drawText(line, 4, y + lineH * (i + 2), '#888');
                }
            }
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // fail
        canvas.drawText('Restart failed', 4, y, '#fff');
        if (output) {
            var failLines = output.split('\n');
            for (var j = 0; j < failLines.length && j < 6; j++) {
                var fLine = failLines[j];
                if (fLine.length > 42) fLine = fLine.substring(0, 40) + '..';
                canvas.drawText(fLine, 4, y + lineH * (j + 1), '#888');
            }
        }
        canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
    };

    return RestartDriverScene;
})();
