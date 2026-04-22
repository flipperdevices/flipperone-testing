(function() {
    var COMPONENTS = [
        {
            name: 'ResponsiveFrame',
            ctor: ResponsiveFrame,
            description: 'Configurable frame: fill, 1px stroke, per-corner rounded corners, anchor.'
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

    var canvas = new FlipCanvas(canvasEl);
    var input = new Input();
    var currentInstance = null;
    var rafId = null;

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
        controlsBox.innerHTML = '';
        detailEl.classList.add('hidden');
        listEl.classList.remove('hidden');
    }

    backBtn.addEventListener('click', closeDetail);

    gridToggle.addEventListener('change', function() {
        gridEl.classList.toggle('hidden', !gridToggle.checked);
    });

    function render() {
        canvas.ctx.clearRect(0, 0, canvas.w, canvas.h);
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
