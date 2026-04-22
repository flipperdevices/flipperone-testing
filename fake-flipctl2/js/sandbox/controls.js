/**
 * ControlsBuilder
 *
 * Generates sandbox control panels from a component's `tweakables`
 * schema. Each schema entry is one of:
 *
 *   { section: 'name' }                          // starts a new panel
 *   { key, type: 'range', min, max, default }    // number slider
 *   { key, type: 'color', default }              // color picker
 *   { key, type: 'bool',  default, label }       // checkbox
 *   { key, type: 'enum',  options, default, label }  // radio group
 *
 * `key` supports dot paths (e.g. 'corners.tl'). `default` sets the
 * initial value. Labels default to the key.
 */
var ControlsBuilder = (function() {
    var counter = 0;
    function uid() { return 'tk-' + (++counter); }

    function setPath(obj, path, value) {
        var parts = path.split('.');
        var cur = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            if (cur[parts[i]] === undefined) cur[parts[i]] = {};
            cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = value;
    }

    function labelOf(field) { return field.label || field.key; }

    function buildRange(field, apply) {
        var wrap = document.createElement('div');
        wrap.className = 'controls';
        var id = uid();
        var lbl = document.createElement('label');
        lbl.setAttribute('for', id);
        lbl.textContent = labelOf(field);
        var input = document.createElement('input');
        input.type = 'range';
        input.id = id;
        input.min = field.min;
        input.max = field.max;
        input.value = field.default;
        var val = document.createElement('span');
        val.className = 'val';
        val.textContent = field.default;
        input.addEventListener('input', function() {
            var v = parseInt(input.value, 10);
            val.textContent = v;
            apply(v);
        });
        wrap.appendChild(lbl);
        wrap.appendChild(input);
        wrap.appendChild(val);
        return wrap;
    }

    function buildColor(field, apply) {
        var wrap = document.createElement('div');
        wrap.className = 'color-row';
        var input = document.createElement('input');
        input.type = 'color';
        input.value = field.default;
        var code = document.createElement('code');
        code.textContent = field.default;
        input.addEventListener('input', function() {
            code.textContent = input.value;
            apply(input.value);
        });
        wrap.appendChild(input);
        wrap.appendChild(code);
        return wrap;
    }

    function buildBool(field, apply) {
        var wrap = document.createElement('div');
        wrap.className = 'toggles';
        var lbl = document.createElement('label');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!field.default;
        input.addEventListener('change', function() { apply(input.checked); });
        lbl.appendChild(input);
        lbl.appendChild(document.createTextNode(' ' + labelOf(field)));
        wrap.appendChild(lbl);
        return wrap;
    }

    function buildEnum(field, apply) {
        var outer = document.createElement('div');
        if (field.label) {
            var sub = document.createElement('div');
            sub.className = 'sublabel';
            sub.textContent = field.label;
            outer.appendChild(sub);
        }
        var wrap = document.createElement('div');
        wrap.className = 'radio-group';
        var name = uid();
        field.options.forEach(function(opt) {
            var lbl = document.createElement('label');
            var input = document.createElement('input');
            input.type = 'radio';
            input.name = name;
            input.value = String(opt);
            if (opt === field.default) input.checked = true;
            input.addEventListener('change', function() {
                if (input.checked) apply(opt);
            });
            lbl.appendChild(input);
            lbl.appendChild(document.createTextNode(' ' + String(opt)));
            wrap.appendChild(lbl);
        });
        outer.appendChild(wrap);
        return outer;
    }

    var BUILDERS = {
        range: buildRange,
        color: buildColor,
        bool:  buildBool,
        enum:  buildEnum
    };

    function buildPanel(title) {
        var panel = document.createElement('div');
        panel.className = 'panel';
        if (title) {
            var t = document.createElement('div');
            t.className = 'panel-title';
            t.textContent = title;
            panel.appendChild(t);
        }
        return panel;
    }

    function build(schema, container, onChange) {
        container.innerHTML = '';
        var panel = null;
        schema.forEach(function(field) {
            if (field.section !== undefined) {
                panel = buildPanel(field.section);
                container.appendChild(panel);
                return;
            }
            if (!panel) {
                panel = buildPanel('');
                container.appendChild(panel);
            }
            var builder = BUILDERS[field.type];
            if (!builder) return;
            panel.appendChild(builder(field, function(v) {
                onChange(field.key, v);
            }));
        });
    }

    function defaults(schema) {
        var opts = {};
        schema.forEach(function(field) {
            if (field.section !== undefined) return;
            setPath(opts, field.key, field.default);
        });
        return opts;
    }

    return {
        build: build,
        defaults: defaults,
        setPath: setPath
    };
})();
