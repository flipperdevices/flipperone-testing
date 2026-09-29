/**
 * UiBuilderLivePreviewScene
 *
 * Testing → 'UI Builder live preview'. Shows the UI Builder's live page
 * full screen: a bare iframe laid exactly over the #screen canvas, no
 * status bar, no chrome. The iframe is always 256×144 (so the page
 * draws at 1:1 with no letterbox) and is CSS-scaled to the canvas box,
 * which matters when #screen is stretched, e.g. in the PC mirror.
 *
 * The iframe is view-only (pointer-events off, not focusable) so key
 * events keep reaching this page and Back still closes the preview.
 */
var UiBuilderLivePreviewScene = (function() {
    var LIVE_URL = 'http://10.69.10.175:8765/live';
    var CONTAINER_ID = 'ui-builder-live-container';
    var W = 256, H = 144;

    function UiBuilderLivePreviewScene(sceneManager) {
        this.sceneManager    = sceneManager || null;
        this.displayName     = 'UI Builder live preview';
        this.breadcrumbTitle = 'UI Builder live preview';
        this._container = null;
        this._onResize  = null;
        this._onBlur    = null;
    }

    // Match the container to the canvas box on screen and stretch the
    // native-size iframe to fill it.
    function place(container, iframe) {
        var canvas = document.getElementById('screen');
        var r = canvas.getBoundingClientRect();
        container.style.left   = r.left + 'px';
        container.style.top    = r.top + 'px';
        container.style.width  = r.width + 'px';
        container.style.height = r.height + 'px';
        iframe.style.transform = 'scale(' + (r.width / W) + ',' + (r.height / H) + ')';
    }

    UiBuilderLivePreviewScene.prototype.enter = function() {
        if (this._container) return;
        var canvas = document.getElementById('screen');

        var container = document.createElement('div');
        container.id = CONTAINER_ID;
        container.style.position      = 'fixed';
        container.style.zIndex        = '9999';
        container.style.overflow      = 'hidden';
        container.style.background    = '#fff';
        container.style.pointerEvents = 'none';

        var iframe = document.createElement('iframe');
        iframe.src      = LIVE_URL;
        iframe.tabIndex = -1;
        iframe.setAttribute('scrolling', 'no');
        iframe.style.display = 'block';
        iframe.style.border  = 'none';
        iframe.style.margin  = '0';
        iframe.style.padding = '0';
        iframe.style.width   = W + 'px';
        iframe.style.height  = H + 'px';
        iframe.style.transformOrigin = '0 0';

        container.appendChild(iframe);
        document.body.appendChild(container);
        place(container, iframe);
        canvas.style.visibility = 'hidden';

        this._container = container;
        this._onResize = function() { place(container, iframe); };
        window.addEventListener('resize', this._onResize);
        // If the iframe grabs focus anyway, take it back so Back works.
        this._onBlur = function() { setTimeout(function() { window.focus(); }, 0); };
        window.addEventListener('blur', this._onBlur);
    };

    UiBuilderLivePreviewScene.prototype.exit = function() {
        if (this._onResize) window.removeEventListener('resize', this._onResize);
        if (this._onBlur)   window.removeEventListener('blur', this._onBlur);
        this._onResize = null;
        this._onBlur   = null;
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._container = null;
        document.getElementById('screen').style.visibility = 'visible';
    };

    UiBuilderLivePreviewScene.prototype.handleInput = function(action) {
        if (action === 'back' || action === 'esc') {
            this.exit();
            return 'pop';
        }
    };

    // The iframe covers the canvas; nothing to draw.
    UiBuilderLivePreviewScene.prototype.render = function(canvas) {
        canvas.clear('#fff');
    };

    return UiBuilderLivePreviewScene;
})();
