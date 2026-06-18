/**
 * DesktopComputerScene
 *
 * Placeholder app for the Desktop (graphical) target. Surfaced as the
 * main-menu's first item when that target is active. Empty for now —
 * just the standard app chrome (status bar + gray title strip with the
 * desktop_computer icon and the app name). Back / Esc pops.
 */
var DesktopComputerScene = (function() {
    var TITLE_H = 16;

    function DesktopComputerScene(sceneManager) {
        this.sceneManager = sceneManager || null;
        this.displayName  = 'Desktop Computer';
        this.imagePath    = null;
        this.icon = (typeof Icons !== 'undefined') ? Icons.desktop_computer : null;
    }

    DesktopComputerScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, this.imagePath, this.icon,
                function(sm) { return new DesktopComputerScene(sm); });
        }
        if (window.requestRender) window.requestRender();
    };

    DesktopComputerScene.prototype.exit = function() {};

    DesktopComputerScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };

    DesktopComputerScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
        var ctx = canvas.ctx;
        if (typeof UI !== 'undefined' && UI.drawStatusBar) {
            UI.drawStatusBar(canvas, '');
        }
        var TITLE_Y = UI.STATUS_BAR_H;
        ctx.fillStyle = '#D9D9D9';
        ctx.fillRect(0, TITLE_Y, canvas.w, TITLE_H);
        if (this.icon) {
            canvas.drawSprite(this.icon, 2, TITLE_Y + 1, '#000');
        }
        Born2bSportyV2Medium.draw(ctx, this.displayName, 20, UI.STATUS_BAR_H, '#000');

        // Placeholder body — "In progress" centred on the screen.
        var msg  = 'In progress';
        var msgW = HaxrcorpFont16.textWidth(msg);
        HaxrcorpFont16.draw(ctx, msg,
            Math.floor((canvas.w - msgW) / 2),
            Math.floor((canvas.h - 11) / 2), '#666');
    };

    return DesktopComputerScene;
})();
