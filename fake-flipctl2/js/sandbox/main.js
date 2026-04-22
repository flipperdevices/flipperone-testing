(function() {
    var COMPONENTS = [
        {
            name: 'ResponsiveFrame',
            ctor: ResponsiveFrame,
            description: 'Configurable frame: fill, 1px stroke, per-corner rounded corners, anchor.'
        },
        {
            name: 'MenuSelectorFrame',
            ctor: MenuSelectorFrame,
            description: 'Selection frame for menu entries. Starts as a duplicate of ResponsiveFrame.',
            bboxPadding: { top: 0, right: 1, bottom: 1, left: 0 }
        }
    ];

    var listEl       = document.getElementById('componentList');
    var detailEl     = document.getElementById('componentDetail');
    var cardGrid     = document.getElementById('cardGrid');
    var backBtn      = document.getElementById('backBtn');
    var detailName   = document.getElementById('detailName');
    var controlsBox  = document.getElementById('controls');
    var canvasEl     = document.getElementById('screen');
    var gridToggle   = document.getElementById('gridToggle');
    var gridEl       = document.getElementById('grid');
    var bboxToggle   = document.getElementById('bboxToggle');

    var BBOX_HIGHLIGHT_COLOR = '#ff0000';

    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
    var currentInstance = null;
    var currentComponent = null;
    var rafId = null;

    function getBBox(inst) {
        if (inst.x === undefined || inst.y === undefined ||
            inst.width === undefined || inst.height === undefined) return null;
        var ox = inst.anchorH === 'center' ? Math.floor(inst.width / 2)
               : inst.anchorH === 'right'  ? inst.width : 0;
        var oy = inst.anchorV === 'center' ? Math.floor(inst.height / 2)
               : inst.anchorV === 'bottom' ? inst.height : 0;
        return { x: inst.x - ox, y: inst.y - oy, w: inst.width, h: inst.height };
    }

    function renderList() {
        cardGrid.innerHTML = '';
        COMPONENTS.forEach(function(c) {
            var card = document.createElement('button');
            card.className = 'card';
            card.innerHTML =
                '<div class="card-name">' + c.name + '</div>' +
                '<div class="card-desc">' + c.description + '</div>';
            card.addEventListener('click', function() { openDetail(c); });
            cardGrid.appendChild(card);
        });
    }

    function openDetail(c) {
        detailName.textContent = c.name;
        var schema = c.ctor.tweakables;
        var options = ControlsBuilder.defaults(schema);
        currentInstance = new c.ctor(options);
        currentComponent = c;
        ControlsBuilder.build(schema, controlsBox, function(path, value) {
            ControlsBuilder.setPath(currentInstance, path, value);
        });
        listEl.classList.add('hidden');
        detailEl.classList.remove('hidden');
        startLoop();
    }

    function closeDetail() {
        stopLoop();
        currentInstance = null;
        currentComponent = null;
        controlsBox.innerHTML = '';
        detailEl.classList.add('hidden');
        listEl.classList.remove('hidden');
    }

    backBtn.addEventListener('click', closeDetail);

    var refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', function(e) {
        e.preventDefault();
        if (!currentComponent) return;
        var c = currentComponent;
        var schema = c.ctor.tweakables;
        var options = ControlsBuilder.defaults(schema);
        currentInstance = new c.ctor(options);
        ControlsBuilder.build(schema, controlsBox, function(path, value) {
            ControlsBuilder.setPath(currentInstance, path, value);
        });
        render();
    });

    gridToggle.addEventListener('change', function() {
        gridEl.classList.toggle('hidden', !gridToggle.checked);
    });

    function render() {
        canvas.ctx.clearRect(0, 0, canvas.w, canvas.h);
        if (currentInstance && currentComponent && bboxToggle.checked) {
            var bb = getBBox(currentInstance);
            if (bb) {
                var p = currentComponent.bboxPadding || { top: 0, right: 0, bottom: 0, left: 0 };
                canvas.ctx.fillStyle = BBOX_HIGHLIGHT_COLOR;
                canvas.ctx.fillRect(
                    bb.x - p.left,
                    bb.y - p.top,
                    bb.w + p.left + p.right,
                    bb.h + p.top + p.bottom
                );
            }
        }
        if (currentInstance && currentInstance.render) {
            currentInstance.render(canvas);
        }
    }

    function loop() {
        input.processQueue();
        render();
        rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
        if (rafId === null) rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
    }

    renderList();
})();
