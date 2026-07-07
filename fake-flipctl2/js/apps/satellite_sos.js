/**
 * SatelliteSOSScene
 *
 * Satellite SOS app. Empty for now — just the standard app chrome
 * (status bar + gray title strip with the satllite icon and the app
 * name). Back / Esc pops.
 */
var SatelliteSOSScene = (function() {
    var TITLE_H = 16;

    function SatelliteSOSScene(sceneManager) {
        this.sceneManager = sceneManager || null;
        this.displayName  = 'Satellite SOS';
        this.imagePath    = null;
        this.icon = (typeof Icons !== 'undefined') ? Icons.satllite : null;
    }

    SatelliteSOSScene.prototype.enter = function() {
        if (typeof RunningApps !== 'undefined') {
            RunningApps.open(this.displayName, this.imagePath, this.icon,
                function(sm) { return new SatelliteSOSScene(sm); });
        }
        if (window.requestRender) window.requestRender();
    };

    SatelliteSOSScene.prototype.exit = function() {};

    SatelliteSOSScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') return 'pop';
    };

    SatelliteSOSScene.prototype.render = function(canvas) {
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
        Born2bSportyV2FlipCTL.draw(ctx, this.displayName, 20, UI.STATUS_BAR_H, '#000');

        // Placeholder body — "In progress" centred on the screen.
        var msg  = 'In progress';
        var msgW = HaxrCorp4090FlipCTL.textWidth(msg);
        HaxrCorp4090FlipCTL.draw(ctx, msg,
            Math.floor((canvas.w - msgW) / 2),
            Math.floor((canvas.h - 11) / 2), '#666');
    };

    return SatelliteSOSScene;
})();
