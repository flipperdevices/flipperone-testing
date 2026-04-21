var FigmaLivePreviewScene = (function() {
    var FIGMA_URL = 'https://embed.figma.com/proto/PhlEqdtgjFfcizdVV0qNSR/Flipper-One-UI---Main-board?node-id=768-758&starting-point-node-id=768-758&scaling=fill&content-scaling=responsive&footer=false&viewport-controls=false&hotspot-hints=0&device-frame=false&hide-ui=1&embed-host=share';

    function FigmaLivePreviewScene(sceneManager) {
        this.sceneManager = sceneManager;
        this.iframe = null;
        this.container = null;
    }

    FigmaLivePreviewScene.prototype.enter = function() {
        var canvas = document.getElementById('screen');
        var canvasRect = canvas.getBoundingClientRect();

        // Create container for iframe at same position as canvas
        this.container = document.createElement('div');
        this.container.id = 'figma-container';
        this.container.style.width = '256px';
        this.container.style.height = '144px';
        this.container.style.position = 'fixed';
        this.container.style.top = canvasRect.top + 'px';
        this.container.style.left = canvasRect.left + 'px';
        this.container.style.zIndex = '9999';
        this.container.style.overflow = 'hidden';

        // Create iframe at native resolution
        this.iframe = document.createElement('iframe');
        this.iframe.id = 'figma-iframe';
        this.iframe.style.border = 'none';
        this.iframe.style.width = '256px';
        this.iframe.style.height = '144px';
        this.iframe.style.margin = '0';
        this.iframe.style.padding = '0';
        this.iframe.src = FIGMA_URL;
        this.iframe.allowFullscreen = true;

        this.container.appendChild(this.iframe);

        // Hint overlay: "x2 to exit" rendered in the project's HaxrcorpFont16
        // pixel font on a small canvas, centered along the bottom at 20% opacity.
        // pointer-events: none so it doesn't steal focus from the iframe.
        var hintText = 'x2 to exit';
        var hintW = HaxrcorpFont16.textWidth(hintText);
        var hintH = 11;  // glyph data is 11 rows tall
        var hintCanvas = document.createElement('canvas');
        hintCanvas.width = hintW;
        hintCanvas.height = hintH;
        hintCanvas.style.position = 'absolute';
        hintCanvas.style.top = '0';
        hintCanvas.style.right = '40px';
        hintCanvas.style.pointerEvents = 'none';
        hintCanvas.style.imageRendering = 'pixelated';
        // mix-blend-mode: difference with white glyphs inverts whatever is
        // behind — dark backdrops render white text, light backdrops render
        // black text. opacity attenuates the inversion so the hint reads as
        // subtle rather than full-contrast.
        hintCanvas.style.mixBlendMode = 'difference';
        hintCanvas.style.opacity = '0.2';
        var hctx = hintCanvas.getContext('2d');
        hctx.imageSmoothingEnabled = false;
        HaxrcorpFont16.draw(hctx, hintText, 0, 0, '#fff');
        this.container.appendChild(hintCanvas);

        // App-switcher icon, 2px to the left of the hint text. Same blend
        // mode / opacity so it tracks the text's contrast behavior.
        var iconSprite = Icons.appSwitcher;
        var iconCanvas = document.createElement('canvas');
        iconCanvas.width = iconSprite.w;
        iconCanvas.height = iconSprite.h;
        iconCanvas.style.position = 'absolute';
        iconCanvas.style.top = '2px';
        iconCanvas.style.right = (40 + hintW + 2) + 'px';
        iconCanvas.style.pointerEvents = 'none';
        iconCanvas.style.imageRendering = 'pixelated';
        iconCanvas.style.mixBlendMode = 'difference';
        iconCanvas.style.opacity = '0.2';
        var iconFlip = new FlipCanvas(iconCanvas);
        iconFlip.drawSprite(iconSprite, 0, 0, '#fff');
        this.container.appendChild(iconCanvas);

        document.body.appendChild(this.container);

        // Hide canvas
        canvas.style.visibility = 'hidden';

        // Focus iframe, then start polling for focus loss
        var self = this;
        setTimeout(function() {
            if (self.iframe) {
                self.iframe.focus();
            }
            // Start polling only after iframe has focus
            self._focusPoll = setInterval(function() {
                if (!self.iframe) return;
                if (document.activeElement !== self.iframe) {
                    self.exit();
                    self.sceneManager.pop();
                }
            }, 100);
        }, 1000);
    };

    FigmaLivePreviewScene.prototype.exit = function() {
        // Stop focus polling
        if (this._focusPoll) {
            clearInterval(this._focusPoll);
            this._focusPoll = null;
        }

        var canvas = document.getElementById('screen');
        var container = document.getElementById('figma-container');

        // Show canvas again
        canvas.style.visibility = 'visible';

        // Remove container
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
    };

    FigmaLivePreviewScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') {
            this.exit();
            return 'pop';
        }
    };

    FigmaLivePreviewScene.prototype.render = function(canvas) {
    };

    return FigmaLivePreviewScene;
})();
