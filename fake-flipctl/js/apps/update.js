var UpdateScene = (function() {
    // States: 'checking', 'no-updates', 'available', 'error', 'updating', 'done', 'fail'
    var state = 'checking';
    var commits = [];
    var currentCommit = '';
    var errorMsg = '';
    var scrollOffset = 0;
    var buttonIndex = 0; // 0 = Start update, 1 = Cancel

    function checkUpdate() {
        state = 'checking';
        commits = [];
        errorMsg = '';
        scrollOffset = 0;
        buttonIndex = 0;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/update/check', true);
        xhr.timeout = 20000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                currentCommit = data.currentCommit || '';
                if (data.error) {
                    errorMsg = data.error;
                    state = 'error';
                } else if (data.available) {
                    commits = data.commits || [];
                    state = 'available';
                } else {
                    state = 'no-updates';
                }
            } else {
                errorMsg = 'HTTP ' + xhr.status;
                state = 'error';
            }
        };
        xhr.onerror = function() { errorMsg = 'Network error'; state = 'error'; };
        xhr.ontimeout = function() { errorMsg = 'Timeout'; state = 'error'; };
        xhr.send();
    }

    function applyUpdate() {
        state = 'updating';
        var xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/update/apply', true);
        xhr.timeout = 35000;
        xhr.onload = function() {
            if (xhr.status === 200) {
                var data = JSON.parse(xhr.responseText);
                if (data.success) {
                    state = 'done';
                } else {
                    errorMsg = data.error || 'Unknown error';
                    state = 'fail';
                }
            } else {
                errorMsg = 'HTTP ' + xhr.status;
                state = 'fail';
            }
        };
        xhr.onerror = function() { errorMsg = 'Network error'; state = 'fail'; };
        xhr.ontimeout = function() { errorMsg = 'Timeout'; state = 'fail'; };
        xhr.send();
    }

    function UpdateScene() {}

    UpdateScene.prototype.enter = function() {
        checkUpdate();
    };

    UpdateScene.prototype.exit = function() {};

    UpdateScene.prototype.handleInput = function(action) {
        if (state === 'checking' || state === 'updating') return;

        if (state === 'available') {
            if (action === 'left' || action === 'right') {
                buttonIndex = buttonIndex === 0 ? 1 : 0;
            } else if (action === 'up' && scrollOffset > 0) {
                scrollOffset--;
            } else if (action === 'down') {
                scrollOffset++;
            } else if (action === 'ok') {
                if (buttonIndex === 0) {
                    applyUpdate();
                } else {
                    return 'pop';
                }
            } else if (action === 'back') {
                return 'pop';
            }
            return;
        }

        // All other states: back or ok to go back
        if (action === 'back' || action === 'ok') return 'pop';
    };

    UpdateScene.prototype.render = function(canvas) {
        UI.drawStatusBar(canvas, 'Update');

        var y = UI.STATUS_BAR_H + 3;
        var lineH = 9;

        if (state === 'checking') {
            canvas.drawText('Checking for updates...', 4, y, '#888');
            return;
        }

        if (state === 'updating') {
            canvas.drawText('Updating...', 4, y, '#fff');
            canvas.drawText('Do not power off', 4, y + lineH, '#888');
            return;
        }

        if (state === 'done') {
            canvas.drawText('Update complete!', 4, y, '#fff');
            canvas.drawText('Restarting...', 4, y + lineH, '#888');
            return;
        }

        if (state === 'fail') {
            canvas.drawText('Update failed', 4, y, '#fff');
            canvas.drawText(errorMsg, 4, y + lineH, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        if (state === 'error') {
            canvas.drawText('Error: ' + errorMsg, 4, y, '#fff');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        if (state === 'no-updates') {
            canvas.drawText('No updates available', 4, y, '#fff');
            canvas.drawText(currentCommit, 4, y + lineH + 2, '#888');
            canvas.drawText('[Back]', 4, canvas.h - 9, '#888');
            return;
        }

        // state === 'available'
        canvas.drawText(commits.length + ' new commit' + (commits.length !== 1 ? 's' : ''), 4, y, '#fff');
        y += lineH + 2;

        // Commit list area
        var btnAreaH = 14;
        var listAreaH = canvas.h - y - btnAreaH - 2;
        var maxVisible = Math.floor(listAreaH / lineH);

        if (scrollOffset > Math.max(0, commits.length - maxVisible)) {
            scrollOffset = Math.max(0, commits.length - maxVisible);
        }

        for (var i = scrollOffset; i < commits.length && (i - scrollOffset) < maxVisible; i++) {
            var text = commits[i];
            // Truncate to fit screen width (roughly 42 chars at 6px each)
            if (text.length > 42) text = text.substring(0, 40) + '..';
            canvas.drawText(text, 4, y + (i - scrollOffset) * lineH, '#888');
        }

        // Buttons at bottom
        var btnY = canvas.h - 11;
        var startLabel = '[Start update]';
        var cancelLabel = '[Cancel]';

        if (buttonIndex === 0) {
            canvas.drawText(startLabel, 4, btnY, '#fff');
            canvas.drawText(cancelLabel, 4 + startLabel.length * 6 + 12, btnY, '#888');
        } else {
            canvas.drawText(startLabel, 4, btnY, '#888');
            canvas.drawText(cancelLabel, 4 + startLabel.length * 6 + 12, btnY, '#fff');
        }
    };

    return UpdateScene;
})();
