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
  // What each script loaded by `loadScript` declared as it ran, by its URL:
  // { widgets: [meta…], toolkit: meta|null, problems: [text…] }.
  var declared = {};

  /** The URL of the script running now, absolute ('' outside a script). */
  function runningScript() {
    var s = document.currentScript;
    return (s && s.src) || '';
  }

  function declaredFor(src) {
    if (!declared[src]) declared[src] = { widgets: [], toolkit: null, problems: [] };
    return declared[src];
  }

  /** `href` resolved against `from` (a toolkit's own URL); absolute is left alone. */
  function resolveAgainst(href, from) {
    try { return new URL(href, from || document.baseURI).href; } catch (e) { return href; }
  }

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
        // A widget added by the user from a URL (see `Sienna.widget` below):
        // who made it and what it is, for the shell to show before and after.
        external: !!spec.external,
        notes: spec.notes || '',
        author: spec.author || '',
        version: spec.version || '',
        integrity: spec.integrity || '',
        method: null,
        promise: null,
      };
    },

    /** Forget a widget (one the user added and has now removed). */
    unregister: function (name) {
      if (!registry[name]) return;
      delete registry[name];
      order = order.filter(function (n) { return n !== name; });
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
          external: e.external,
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
        src: e.src, external: e.external, notes: e.notes, author: e.author,
        version: e.version, integrity: e.integrity,
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
        if (entry.integrity) {
          // Subresource Integrity: a file that has changed since it was
          // pinned is refused. Needs the server's CORS consent, hence this.
          script.integrity = entry.integrity;
          script.crossOrigin = 'anonymous';
        }
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
     * Run a script the user named (a widget or a toolkit, by URL) and resolve
     * to what it declared as it ran: `{ widgets: [spec…], toolkit, problems }`.
     * Rejects only if the script could not be fetched at all. Running it is
     * the trust decision, so a caller asks the user BEFORE calling this.
     * @param {string} url
     * @param {{ integrity?: string }} [opts]
     */
    loadScript: function (url, opts) {
      var src = resolveAgainst(url);
      delete declared[src];
      return new Promise(function (resolve, reject) {
        var script = document.createElement('script');
        script.src = src;
        if (opts && opts.integrity) {
          script.integrity = opts.integrity;
          script.crossOrigin = 'anonymous';
        }
        script.onload = function () {
          var d = declaredFor(src);
          if (!d.widgets.length && !d.toolkit && !d.problems.length) {
            d.problems.push('It ran, but declared neither a widget (Sienna.widget) nor a toolkit (Sienna.toolkit).');
          }
          resolve({ widgets: d.widgets.slice(), toolkit: d.toolkit, problems: d.problems.slice() });
        };
        script.onerror = function () {
          reject(new Error('Could not load ' + url + ' (no such file, no network, or refused by the browser).'));
        };
        document.head.appendChild(script);
      });
    },

    /** See `Sienna.widget`. */
    _declareWidget: function (meta) {
      var src = runningScript();
      var d = declaredFor(src);
      var $ = window.jQuery;
      meta = meta || {};
      var name = meta.name;
      if (!name || !/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
        d.problems.push('A widget needs a name of letters, digits and _ (starting with a letter); got "' + (name || '') + '".');
        return false;
      }
      if ((meta.contract || 1) > Sienna.widgetContract) {
        d.problems.push('"' + name + '" needs a newer version of the shell (widget contract ' + meta.contract
          + '; this one is ' + Sienna.widgetContract + ').');
        return false;
      }
      var mine = registry[name];
      // Never replace a built-in widget, another added widget, or anything
      // jQuery already answers to: `$.widget` would overwrite it silently.
      if (mine && !(mine.external && mine.src === src)) {
        d.problems.push('There is already a widget called "' + name + '"; this one was not added.');
        return false;
      }
      if (!mine && $.fn[name]) {
        d.problems.push('"' + name + '" is a name the page already uses; this widget was not added.');
        return false;
      }
      if (!meta.widget || typeof meta.widget !== 'object') {
        d.problems.push('"' + name + '" has no `widget` (the widget\'s own methods).');
        return false;
      }
      if (!$.sienna[name]) $.widget('sienna.' + name, meta.base || $.sienna.widgetBase, meta.widget);
      var spec = {
        src: src, label: meta.label, title: meta.title, options: meta.options,
        thumbnail: meta.thumbnail, workingSize: meta.workingSize, role: meta.role,
        external: true, notes: meta.notes, author: meta.author, version: meta.version,
      };
      if (mine) {
        // Already known (remembered from an earlier visit, now being loaded
        // for use): keep the entry, so a `loadWidget` waiting on it resolves.
        mine.method = name;
      } else {
        this.register(name, spec);
        registry[name].method = name;
      }
      spec.name = name;
      d.widgets.push(spec);
      return true;
    },

    /** See `Sienna.toolkit`. */
    _declareToolkit: function (meta) {
      var src = runningScript();
      var d = declaredFor(src);
      meta = meta || {};
      var list = Array.isArray(meta.widgets) ? meta.widgets : [];
      if (!list.length) {
        d.problems.push('The toolkit lists no widgets.');
        return false;
      }
      d.toolkit = {
        src: src,
        name: meta.name || '',
        label: meta.label || meta.name || src,
        notes: meta.notes || '',
        author: meta.author || '',
        version: meta.version || '',
        // Relative to the toolkit's own URL, so a toolkit can be a folder.
        widgets: list.map(function (w) {
          var o = typeof w === 'string' ? { src: w } : (w || {});
          return { src: resolveAgainst(o.src, src), integrity: o.integrity || '' };
        }),
      };
      return true;
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

  /**
   * The version of the widget contract this shell hosts. A widget declares
   * the one it was written for (`contract`, default 1); one newer than this
   * is refused with a message rather than half working.
   */
  Sienna.widgetContract = 1;

  /**
   * How a widget that is not built into the app declares itself — the whole
   * of an added widget's script is one call:
   *
   *   Sienna.widget({
   *     name: 'dice',                 // its name: letters, digits, _
   *     label: 'Dice', title: 'Dice', // menu label, panel title
   *     role: 'display',              // which collection it opens in (optional)
   *     options: { sides: 6 },        // default options (optional)
   *     notes: 'Rolls a die.', author: 'A. N. Other', version: '1.0',
   *     contract: 1,                  // the widget contract it was written for
   *     widget: { _create: function () { … }, … },  // the jQuery UI widget
   *   });
   *
   * `widget` is the prototype `$.widget` is given; it extends
   * `$.sienna.widgetBase` (or `base`, if given), so `_ref`, `_get`, `_set`,
   * `_action` and `_watchModel` are there to use. A name already taken is
   * refused: an added widget can never replace one the app has.
   */
  Sienna.widget = function (meta) {
    return Sienna.widgetRegistry._declareWidget(meta);
  };

  /**
   * A toolkit: several added widgets, given by one URL. Its script is one call:
   *
   *   Sienna.toolkit({
   *     name: 'games', label: 'Games', notes: '…', author: '…', version: '1',
   *     widgets: ['dice.js', 'https://example.org/w/clock.js',
   *               { src: 'spinner.js', integrity: 'sha384-…' }],
   *   });
   *
   * A relative URL is relative to the toolkit's own file, so a folder holding
   * `toolkit.js` beside its widgets can be moved, or put online, as a whole.
   */
  Sienna.toolkit = function (meta) {
    return Sienna.widgetRegistry._declareToolkit(meta);
  };
})(window.Sienna);
