/**
 * Registry of dynamically loadable content widgets, exposed as
 * `Sienna.widgetRegistry`.
 *
 * Because the app runs from file:// with no bundler, dynamic loading is done by
 * INJECTING a classic <script> tag (ES `import()` is blocked over file://).
 * Each widget is registered with the URL of its script plus the presentation
 * metadata used to build the menu (label, panel title, default options), so the
 * registry is the single source of truth for "which widgets exist". On first
 * use the script is injected; when it runs it self-registers via `$.widget(...)`
 * and calls `Sienna.widgetRegistry._loaded(name, method)` to record the jQuery
 * UI plugin method name to invoke on a panel's content element.
 */
(function (Sienna) {
  'use strict';

  var registry = {}; // name -> { src, label, title, options, method, promise }
  var order = []; // registration order, for stable menu ordering

  Sienna.widgetRegistry = {
    /**
     * @param {string} name
     * @param {{ src: string, label?: string, title?: string, options?: object }} spec
     *   src    — widget script URL, relative to index.html
     *   label  — menu label (default: name)
     *   title  — panel titlebar text (default: label)
     *   options — default options passed to the widget (default: {})
     */
    register: function (name, spec) {
      spec = spec || {};
      if (!registry[name]) {
        order.push(name);
      }
      registry[name] = {
        src: spec.src,
        label: spec.label || name,
        title: spec.title || spec.label || name,
        options: spec.options || {},
        method: null,
        promise: null,
      };
    },

    /** @returns {string[]} names of all registered widgets, in registration order */
    names: function () {
      return order.slice();
    },

    /**
     * @returns {Array<{name:string, label:string, title:string, options:object}>}
     *   the presentation metadata for every widget, in registration order —
     *   enough to build a menu without hardcoding the widget list elsewhere.
     */
    list: function () {
      return order.map(function (name) {
        var e = registry[name];
        return {
          name: name,
          label: e.label,
          title: e.title,
          options: e.options,
        };
      });
    },

    /** Called by a widget script once loaded, to record its plugin method name. */
    _loaded: function (name, method) {
      if (registry[name]) {
        registry[name].method = method;
      }
    },

    /**
     * Dynamically load a widget and resolve to its jQuery UI plugin method name.
     * @param {string} name
     * @returns {Promise<string>}
     */
    loadWidget: function (name) {
      var entry = registry[name];
      if (!entry) {
        return Promise.reject(new Error('Unknown widget: "' + name + '"'));
      }
      if (entry.method) {
        return Promise.resolve(entry.method);
      }
      if (entry.promise) {
        return entry.promise;
      }
      entry.promise = new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = entry.src;
        script.onload = function () {
          if (entry.method) {
            resolve(entry.method);
          } else {
            reject(
              new Error(
                'Widget "' +
                  name +
                  '" loaded but did not register a method name',
              ),
            );
          }
        };
        script.onerror = function () {
          entry.promise = null;
          reject(new Error('Failed to load widget script: ' + entry.src));
        };
        document.head.appendChild(script);
      });
      return entry.promise;
    },
  };
})(window.Sienna);
