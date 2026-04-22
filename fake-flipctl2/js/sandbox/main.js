(function() {
    var $ = function(id) { return document.getElementById(id); };

    var canvasEl = $('screen');
    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();

    var xEl = $('x'), yEl = $('y'), wEl = $('w'), hEl = $('h');
    var xv = $('xv'), yv = $('yv'), wv = $('wv'), hv = $('hv');
    var fillEl = $('fillColor'), fillVal = $('fillColorVal');
    var strokeEl = $('strokeColor'), strokeVal = $('strokeColorVal');
    var showStrokeEl = $('showStroke');
    var radiusRadios = document.querySelectorAll('input[name="cornerRadius"]');
    var cornerCheckboxes = document.querySelectorAll('input[name="corner"]');
    var anchorHRadios = document.querySelectorAll('input[name="anchorH"]');
    var anchorVRadios = document.querySelectorAll('input[name="anchorV"]');

    var frame = new ResponsiveFrame({
        x: parseInt(xEl.value, 10),
        y: parseInt(yEl.value, 10),
        width: parseInt(wEl.value, 10),
        height: parseInt(hEl.value, 10),
        fillColor: fillEl.value,
        strokeColor: strokeEl.value,
        showStroke: showStrokeEl.checked,
        cornerRadius: 3,
        corners: { tl: true, tr: true, bl: true, br: true },
        anchorH: 'left',
        anchorV: 'top'
    });

    [xEl, yEl, wEl, hEl].forEach(function(el) {
        el.addEventListener('input', function() {
            frame.setPosition(parseInt(xEl.value, 10), parseInt(yEl.value, 10));
            frame.setSize(parseInt(wEl.value, 10), parseInt(hEl.value, 10));
            xv.textContent = frame.x;
            yv.textContent = frame.y;
            wv.textContent = frame.width;
            hv.textContent = frame.height;
        });
    });

    fillEl.addEventListener('input', function() {
        frame.setFillColor(fillEl.value);
        fillVal.textContent = fillEl.value;
    });

    strokeEl.addEventListener('input', function() {
        frame.setStrokeColor(strokeEl.value);
        strokeVal.textContent = strokeEl.value;
    });

    showStrokeEl.addEventListener('change', function() {
        frame.setShowStroke(showStrokeEl.checked);
    });

    radiusRadios.forEach(function(r) {
        r.addEventListener('change', function() {
            if (r.checked) frame.setCornerRadius(parseInt(r.value, 10));
        });
    });

    cornerCheckboxes.forEach(function(cb) {
        cb.addEventListener('change', function() {
            frame.setCorner(cb.value, cb.checked);
        });
    });

    anchorHRadios.forEach(function(r) {
        r.addEventListener('change', function() {
            if (r.checked) frame.setAnchor(r.value, null);
        });
    });

    anchorVRadios.forEach(function(r) {
        r.addEventListener('change', function() {
            if (r.checked) frame.setAnchor(null, r.value);
        });
    });

    var gridToggle = $('gridToggle');
    var grid = $('grid');
    gridToggle.addEventListener('change', function() {
        grid.classList.toggle('hidden', !gridToggle.checked);
    });

    function render() {
        canvas.ctx.clearRect(0, 0, canvas.w, canvas.h);
        frame.render(canvas);
    }

    function loop() {
        input.processQueue();
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
})();
