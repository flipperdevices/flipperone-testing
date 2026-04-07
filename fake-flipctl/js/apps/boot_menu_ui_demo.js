var UIDemoScene = (function() {
    var FONT_H   = 11;
    var PAD_X    = 4;
    var PAD_Y    = 1;
    var RADIUS   = 2;
    var COLOR_DIM = '#EAEAEA';  // shade of white for unselected items

    var STATE_DEFAULT  = 'default';
    var STATE_SELECTED = 'selected';
    var STATE_PRESSED  = 'pressed';

    function MenuItem(text) {
        this.text  = text;
        this.w     = 150;
        this.h     = FONT_H + PAD_Y * 2;
        this.state = STATE_DEFAULT;
    }

    MenuItem.prototype.render = function(canvas, x, y) {
        if (this.state === STATE_DEFAULT) {
            canvas.drawRoundRect(x, y, this.w, this.h, RADIUS, COLOR_DIM);
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#000');
        } else if (this.state === STATE_SELECTED) {
            canvas.drawRoundFrame(x, y, this.w, this.h, RADIUS, '#000');
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#000');
        } else if (this.state === STATE_PRESSED) {
            canvas.drawRoundRect(x, y, this.w, this.h, RADIUS, '#000');
            HaxrcorpFont16.draw(canvas.ctx, this.text, x + PAD_X, y + PAD_Y, '#fff');
        }
    };

    // ---

    var ITEM_SPACING = 1;

    function UIDemoScene() {
        this.items = [
            new MenuItem('Router'),
            new MenuItem('TV Media Box'),
            new MenuItem('Desktop Computer')
        ];
        this.selectedIndex = 0;
        this.items[this.selectedIndex].state = STATE_SELECTED;
    }

    UIDemoScene.prototype.enter = function() {};
    UIDemoScene.prototype.exit = function() {};

    UIDemoScene.prototype.handleInput = function(action) {
        if (action === 'back') return 'pop';

        if (action === 'up' || action === 'down') {
            this.items[this.selectedIndex].state = STATE_DEFAULT;
            var len = this.items.length;
            this.selectedIndex = (this.selectedIndex + (action === 'down' ? 1 : -1) + len) % len;
            this.items[this.selectedIndex].state = STATE_SELECTED;
        } else if (action === 'ok') {
            var self = this;
            this.items[this.selectedIndex].state = STATE_PRESSED;
            setTimeout(function() {
                self.items[self.selectedIndex].state = STATE_SELECTED;
            }, 200);
        }
    };

    UIDemoScene.prototype.render = function(canvas) {
        canvas.clear('#ffffff');
        var totalH = this.items.length * this.items[0].h + (this.items.length - 1) * ITEM_SPACING;
        var startX = Math.floor((canvas.w - this.items[0].w) / 2);
        var startY = Math.floor((canvas.h - totalH) / 2);

        for (var i = 0; i < this.items.length; i++) {
            var y = startY + i * (this.items[0].h + ITEM_SPACING);
            this.items[i].render(canvas, startX, y);
        }

    };

    return UIDemoScene;
})();
