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
  var base = ''; // prefix for relative widget script URLs (see setBase)

  /** A widget's script URL as this page must ask for it. */
  function scriptUrl(src) {
    if (!base || /^([a-z][a-z0-9+.-]*:|\/)/i.test(src)) return src;
    return base + src;
  }

  Sienna.widgetRegistry = {
    /**
     * @param {string} name
     * @param {{ src: string, label?: string, title?: string, options?: object,
     *           thumbnail?: boolean, workingSize?: {width:number, height:number} }} spec
     *   src    — widget script URL, relative to index.html
     *   label  — menu label (default: name)
     *   title  — panel titlebar text (default: label)
     *   options — default options passed to the widget (default: {})
     *   thumbnail — may this widget shrink to a chrome-free miniature?
     *     (default true). A widget that IS its controls — a transport, a row of
     *     buttons — has nothing left when the controls go, and should say so.
     *   workingSize — the size "open to a working size" opens it at
     *   role — what kind of panel this is ('display', 'diagram', …), which
     *     decides the container it opens in: the first whose `accepts` names
     *     it. No role, or no container accepting it, means the top level.
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
        thumbnail: spec.thumbnail !== false,
        workingSize: spec.workingSize || null,
        role: spec.role || null,
        method: null,
        promise: null,
      };
    },

    /**
     * Say where the manifest's relative `src` URLs are relative TO, from this
     * page: `setBase('../../')` on a page two folders below the app's
     * `index.html`. A manifest's URLs are written for the app's own page, and
     * a page with widgets embedded in it usually lives somewhere else; this
     * lets it use the same manifest unchanged. Absolute URLs are left alone.
     */
    setBase: function (prefix) {
      base = prefix ? String(prefix).replace(/\/?$/, '/') : '';
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

    /** @returns {?object} one widget's registered spec, or null if unknown. */
    spec: function (name) {
      var e = registry[name];
      if (!e) return null;
      return {
        name: name, label: e.label, title: e.title, options: e.options,
        thumbnail: e.thumbnail, workingSize: e.workingSize, role: e.role,
      };
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
        script.src = scriptUrl(entry.src);
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
          reject(new Error('Failed to load widget script: ' + scriptUrl(entry.src)));
        };
        document.head.appendChild(script);
      });
      return entry.promise;
    },

    /**
     * Put a widget straight into an element of an ordinary page — no menu, no
     * workspace, no panel. Loads the widget's script if need be, then creates
     * it on `el` with its registered options overlaid by `options`. A widget
     * that views a model takes it as `options.ref` (see `widgetBase`), which
     * is what a panel's `ref` would otherwise have told it.
     *
     * Resolves to the widget instance. The element is given `slx-embedded`, so
     * a stylesheet can size an embedded widget without knowing which it is,
     * and `<html>` `slx-embedding`, which keeps the shell's whole-window
     * styles (body margin and font) off the page. A page can set that class
     * itself to have it from the first paint.
     * @param {Element|jQuery|string} el
     * @param {string} name
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    embed: function (el, name, options) {
      var $el = window.jQuery(el).first();
      if (!$el.length) return Promise.reject(new Error('No element to embed "' + name + '" in'));
      var spec = registry[name];
      // The page is not the app's: the shell's styles keep to its own
      // elements (see the top of styles.css).
      document.documentElement.classList.add('slx-embedding');
      return this.loadWidget(name).then(function (method) {
        var opts = window.jQuery.extend(true, {}, spec.options, options || {});
        $el.addClass('slx-embedded')[method](opts);
        return $el[method]('instance');
      });
    },
  };
})(window.Sienna);
