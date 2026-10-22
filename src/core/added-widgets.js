/**
 * Widgets the USER adds — `Sienna.addedWidgets`.
 *
 * An app ships with the widgets in its manifest. This lets the user add more
 * that it was not built with: one they wrote themselves, or someone else's,
 * given by URL (or, where the app cannot load a file by its path — any app
 * served over http(s) — by choosing the file). A **toolkit** is several at
 * once: a script declaring a list of widget URLs. The scripts declare
 * themselves with `Sienna.widget({…})` and `Sienna.toolkit({…})` (see
 * `widget-registry.js`), so a widget file is the whole widget, metadata and
 * all.
 *
 * TRUST. An added widget runs in the page with everything the app has: it can
 * read, change or delete the user's saved documents and send them elsewhere.
 * There is no sandbox that keeps the widget contract, so the safeguard is
 * consent: a script runs only after the user has asked for it in a dialog
 * that says so and shows where it comes from; a toolkit's list is shown before
 * any of its widgets is loaded; and nothing a document or session names is
 * ever fetched by itself — an unknown widget there is a placeholder panel
 * (`workspace.addPanel`), not a download.
 *
 * What is remembered (per app, in its own localStorage slot, not in userData:
 * this is the user's set-up, not a document, and is not undone): each added
 * widget's metadata and where it came from — its URL, or the text of the file
 * chosen. Next visit they are REGISTERED from that, so the menu and any panel
 * restored with one work, but a script is loaded only when one is used, as a
 * built-in widget's is. A page that keeps nothing (`Sienna.ephemeral`)
 * remembers nothing here either.
 *
 * An app puts `menuItems(app, open)` at the end of its Widgets menu and
 * leaves out `external` entries when listing its own; `App.setMenu` re-draws
 * the menu when the set changes.
 *
 * Classic script. Load after `widget-registry.js` and `persistence.js`, and
 * BEFORE the app's manifest and `main.js`, so a restored panel finds its
 * widget registered.
 */
(function ($, Sienna) {
  'use strict';

  var reg = Sienna.widgetRegistry;
  var KEY = Sienna.storageKey('addedWidgets.v1');
  var listeners = [];

  // { widgets: [{ name, label, title, role, options, thumbnail, workingSize,
  //               notes, author, version, src, integrity, file, toolkit }],
  //   toolkits: [{ key, label, notes, author, version, src, file }] }
  // `file` is { name, text } for one chosen from disk, else absent; a
  // widget's `toolkit` is the key of the toolkit it came with.
  var store = Sienna.persistence.readJSON(KEY) || {};
  store.widgets = Array.isArray(store.widgets) ? store.widgets : [];
  store.toolkits = Array.isArray(store.toolkits) ? store.toolkits : [];

  function save() {
    Sienna.persistence.writeJSON(KEY, store);
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* a listener's own fault */ } });
  }

  function blobUrl(text) {
    return URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  }

  function isAbsolute(url) {
    return /^[a-z][a-z0-9+.-]*:/i.test(url);
  }

  function baseName(url) {
    return String(url).split(/[?#]/)[0].split('/').pop();
  }

  /** Make a remembered widget known to the registry, without loading it. */
  function registerStored(w) {
    var src = w.file ? blobUrl(w.file.text) : w.src;
    var spec = $.extend({}, w, { src: src, external: true });
    reg.register(w.name, spec);
  }

  store.widgets.forEach(function (w) {
    // A name the app itself has taken since is the app's: skip ours.
    var there = reg.spec(w.name);
    if (!there || there.external) registerStored(w);
  });

  /** Remember a widget the registry has just accepted. */
  function remember(spec, extra) {
    var w = {
      name: spec.name, label: spec.label || spec.name, title: spec.title || spec.label || spec.name,
      role: spec.role || null, options: spec.options || {}, thumbnail: spec.thumbnail !== false,
      workingSize: spec.workingSize || null, notes: spec.notes || '', author: spec.author || '',
      version: spec.version || '', src: extra.file ? '' : spec.src, integrity: extra.integrity || '',
    };
    if (extra.file) w.file = extra.file;
    if (extra.toolkit) w.toolkit = extra.toolkit;
    store.widgets = store.widgets.filter(function (o) { return o.name !== w.name; });
    store.widgets.push(w);
  }

  // ---------------------------------------------------------------- dialogs

  /**
   * A small modal dialog on the page body. `buttons`: [{ label, primary,
   * onClick }]; an onClick returning false keeps it open. Esc or the backdrop
   * closes it. `onClose` hears every close, however it came. Returns
   * { $body, close }.
   */
  function dialog(title, $body, buttons, onClose) {
    var $overlay = $('<div class="slx-dialog-overlay">').appendTo(document.body);
    var $box = $('<div class="slx-dialog" role="dialog" aria-modal="true">').appendTo($overlay);
    $('<h2 class="slx-dialog-title">').text(title).appendTo($box);
    $box.append($body.addClass('slx-dialog-body'));
    var $buttons = $('<div class="slx-dialog-buttons">').appendTo($box);
    function close() {
      if (!$overlay.parent().length) return;
      $(document).off('keydown', onKey);
      $overlay.remove();
      if (onClose) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    $(document).on('keydown', onKey);
    $overlay.on('mousedown', function (e) { if (e.target === $overlay[0]) close(); });
    (buttons || [{ label: 'Close', primary: true }]).forEach(function (b) {
      $('<button type="button" class="slx-dialog-btn">')
        .text(b.label)
        .toggleClass('slx-dialog-btn--primary', !!b.primary)
        .on('click', function () {
          if (b.onClick && b.onClick() === false) return;
          close();
        })
        .appendTo($buttons);
    });
    var $first = $box.find('input, button.slx-dialog-btn--primary').first();
    setTimeout(function () { $first.trigger('focus'); }, 0);
    return { $body: $body, close: close };
  }

  function warning() {
    return $('<p class="slx-dialog-warning">').text(
      'An added widget runs inside this app with everything the app has: it can '
      + 'read, change or delete your saved work and send it elsewhere. Add only '
      + 'widgets from people you trust.');
  }

  function describe(meta) {
    var $d = $('<div class="slx-added-desc">');
    var head = meta.label || meta.name || '';
    if (meta.version) head += ' ' + meta.version;
    $('<strong>').text(head).appendTo($d);
    if (meta.author) $('<span class="slx-added-author">').text(' by ' + meta.author).appendTo($d);
    if (meta.notes) $('<p>').text(meta.notes).appendTo($d);
    return $d;
  }

  /** Say what happened: what was added, and every problem met on the way. */
  function report(added, problems) {
    var $b = $('<div>');
    if (added.length) {
      $('<p>').text(added.length === 1 ? 'Added to the Widgets menu:' : 'Added to the Widgets menu (' + added.length + '):').appendTo($b);
      added.forEach(function (w) { describe(w).appendTo($b); });
    } else {
      $('<p>').text('Nothing was added.').appendTo($b);
    }
    if (problems.length) {
      var $ul = $('<ul class="slx-dialog-problems">').appendTo($b);
      problems.forEach(function (p) { $('<li>').text(p).appendTo($ul); });
    }
    dialog(added.length ? 'Widgets added' : 'Not added', $b);
  }

  /**
   * Run one script (already consented to) and collect what it declared.
   * `file` is { name, text } when it came from disk.
   */
  function runOne(url, opts) {
    return reg.loadScript(url, opts).catch(function (err) {
      return { widgets: [], toolkit: null, problems: [err.message] };
    });
  }

  /**
   * A toolkit's widgets: show the list, and load them only on a yes.
   *
   * A toolkit CHOSEN AS A FILE cannot find the widget files beside it: a
   * browser never tells a page which folder a chosen file came from, only
   * the files themselves. So any it lists by a relative URL must be chosen
   * too — with it, or here, where the missing ones are named and a button
   * chooses them (added to `picked`).
   */
  function confirmToolkit(tk, picked, fromFile) {
    return new Promise(function (resolve) {
      var $b = $('<div>');
      describe(tk).appendTo($b);
      $('<p>').text('It lists ' + tk.widgets.length + ' widget' + (tk.widgets.length === 1 ? '' : 's') + ':').appendTo($b);
      var $ul = $('<ul class="slx-dialog-urls">').appendTo($b);
      var $need = $('<div class="slx-dialog-need">').appendTo($b);
      var $file = $('<input type="file" accept=".js,text/javascript" multiple hidden>').appendTo($b);
      function missing() {
        if (!fromFile) return [];
        return tk.widgets.filter(function (w) {
          return !isAbsolute(w.src) && !picked[baseName(w.src)];
        }).map(function (w) { return baseName(w.src); });
      }
      function draw() {
        $ul.empty();
        var gone = missing();
        tk.widgets.forEach(function (w) {
          var name = baseName(w.src);
          var $li = $('<li>').appendTo($ul);
          if (picked && picked[name]) $li.text(name + ' (selected file)');
          else if (gone.indexOf(name) >= 0) $li.text(name + ' — not selected yet').addClass('slx-dialog-missing');
          else $li.text(w.src);
        });
        $need.empty();
        if (gone.length) {
          $('<p class="slx-dialog-hint">').text(
            'The toolkit was selected as a file, and a browser does not tell a page which folder a selected '
            + 'file is in, so its widget files must be individually selected (they are usually in the same folder).')
            .appendTo($need);
          $('<button type="button" class="slx-dialog-btn">')
            .text('Select the files you want…')
            .on('click', function () { $file.trigger('click'); })
            .appendTo($need);
        }
      }
      $file.on('change', function () {
        var files = Array.prototype.slice.call(this.files || []);
        Promise.all(files.map(function (f) {
          return f.text().then(function (text) {
            picked[f.name] = { name: f.name, text: text, url: blobUrl(text) };
          });
        })).then(draw);
        this.value = '';
      });
      draw();
      warning().appendTo($b);
      var yes = false;
      // Esc, the backdrop or Cancel: no.
      dialog('Load this toolkit?', $b, [
        { label: 'Cancel' },
        { label: 'Load them', primary: true, onClick: function () { yes = true; } },
      ], function () { resolve(yes); });
    });
  }

  /**
   * Add from a URL, or from chosen files. What each script turns out to be
   * decides what happens: a widget is added; a toolkit's list is shown and,
   * on a yes, its widgets are loaded and added.
   * @param {{ url?: string, files?: File[] }} source
   */
  function add(source) {
    var added = [];
    var problems = [];
    var picked = null; // basename -> { name, text, url }

    function take(result, extra) {
      result.problems.forEach(function (p) { problems.push(p); });
      result.widgets.forEach(function (spec) {
        remember(spec, extra);
        added.push(spec);
      });
    }

    function loadToolkit(tk, tkFile) {
      var key = tk.name || tk.src;
      return confirmToolkit(tk, picked, !!tkFile).then(function (yes) {
        if (!yes) { problems.push('The toolkit\'s widgets were not loaded.'); return; }
        store.toolkits = store.toolkits.filter(function (o) { return o.key !== key; });
        store.toolkits.push({
          key: key, label: tk.label, notes: tk.notes, author: tk.author, version: tk.version,
          src: tkFile ? '' : tk.src, file: tkFile ? { name: tkFile.name } : undefined,
        });
        return tk.widgets.reduce(function (p, w) {
          return p.then(function () {
            var own = picked && picked[baseName(w.src)];
            if (own) {
              // Listed by a toolkit chosen from disk, and chosen with it.
              return runOne(own.url).then(function (r) {
                take(r, { file: { name: own.name, text: own.text }, toolkit: key });
              });
            }
            if (tkFile && !isAbsolute(w.src)) {
              problems.push(baseName(w.src) + ': listed by the toolkit, but not selected, so not added.');
              return;
            }
            return runOne(w.src, { integrity: w.integrity }).then(function (r) {
              take(r, { integrity: w.integrity, toolkit: key });
            });
          });
        }, Promise.resolve());
      });
    }

    var done;
    if (source.url) {
      done = runOne(source.url).then(function (r) {
        take(r, {});
        if (r.toolkit) return loadToolkit(r.toolkit, null);
      });
    } else {
      done = Promise.all(source.files.map(function (f) {
        return f.text().then(function (text) { return { name: f.name, text: text, url: blobUrl(text) }; });
      })).then(function (files) {
        picked = {};
        files.forEach(function (f) { picked[f.name] = f; });
        // Toolkits first, so the files a toolkit lists are loaded as its own.
        var listed = {};
        return files.reduce(function (p, f) {
          return p.then(function () {
            if (listed[f.name]) return;
            return runOne(f.url).then(function (r) {
              take(r, { file: { name: f.name, text: f.text } });
              if (r.toolkit) {
                r.toolkit.widgets.forEach(function (w) { listed[baseName(w.src)] = true; });
                return loadToolkit(r.toolkit, f);
              }
            });
          });
        }, Promise.resolve());
      });
    }
    return done.then(function () {
      save();
      report(added, problems);
      return added;
    });
  }

  /** The dialog for one widget or one toolkit: a URL, or a file. */
  function addDialog(kind) {
    var toolkit = kind === 'toolkit';
    var $b = $('<div>');
    $('<label class="slx-dialog-label">').text(toolkit ? 'Toolkit URL' : 'Widget URL').appendTo($b);
    var $url = $('<input type="url" class="slx-dialog-input" spellcheck="false">')
      .attr('placeholder', toolkit ? 'https://…/toolkit.js' : 'https://…/my-widget.js')
      .appendTo($b);
    var $or = $('<p class="slx-dialog-or">').appendTo($b);
    $or.append(document.createTextNode('or '));
    var $file = $('<input type="file" accept=".js,text/javascript" multiple hidden>').appendTo($b);
    $('<button type="button" class="slx-dialog-link">')
      .text(toolkit ? 'select the toolkit file and its widget files…' : 'select a file on this computer…')
      .on('click', function () { $file.trigger('click'); })
      .appendTo($or);
    if (location.protocol !== 'file:') {
      $('<p class="slx-dialog-hint">').text(
        'This app is served from the web, so it cannot load a file on your computer by its path: '
        + 'select the file instead. It is kept with your settings.').appendTo($b);
    }
    warning().appendTo($b);
    var d = dialog(toolkit ? 'Add a toolkit' : 'Add a widget', $b, [
      { label: 'Cancel' },
      {
        label: 'Add', primary: true,
        onClick: function () {
          var url = $.trim($url.val());
          if (!url) { $url.trigger('focus'); return false; }
          add({ url: url });
        },
      },
    ]);
    $url.on('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); d.$body.closest('.slx-dialog').find('.slx-dialog-btn--primary').trigger('click'); }
    });
    $file.on('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      if (!files.length) return;
      d.close();
      add({ files: files });
    });
  }

  function remove(name) {
    store.widgets = store.widgets.filter(function (w) { return w.name !== name; });
    var spec = reg.spec(name);
    if (spec && spec.external) reg.unregister(name);
    // A toolkit with nothing left of it goes too.
    store.toolkits = store.toolkits.filter(function (tk) {
      return store.widgets.some(function (w) { return w.toolkit === tk.key; });
    });
    save();
  }

  function manageDialog() {
    var $b = $('<div class="slx-added-list">');
    function draw() {
      $b.empty();
      if (!store.widgets.length) {
        $('<p>').text('No widgets have been added. Use Widgets ▸ Add a widget… or Add a toolkit….').appendTo($b);
        return;
      }
      var groups = [{ tk: null, widgets: store.widgets.filter(function (w) { return !w.toolkit; }) }]
        .concat(store.toolkits.map(function (tk) {
          return { tk: tk, widgets: store.widgets.filter(function (w) { return w.toolkit === tk.key; }) };
        }));
      groups.forEach(function (g) {
        if (!g.widgets.length) return;
        var $g = $('<div class="slx-added-group">').appendTo($b);
        if (g.tk) {
          var $h = $('<div class="slx-added-toolkit">').appendTo($g);
          $('<span>').text('Toolkit: ').appendTo($h);
          describe(g.tk).appendTo($h);
          $('<div class="slx-added-src">').text(g.tk.src || (g.tk.file && g.tk.file.name + ' (selected file)') || '').appendTo($h);
          $('<button type="button" class="slx-dialog-btn">').text('Remove toolkit').on('click', function () {
            g.widgets.forEach(function (w) { remove(w.name); });
            draw();
          }).appendTo($h);
        }
        g.widgets.forEach(function (w) {
          var $w = $('<div class="slx-added-widget">').appendTo($g);
          describe(w).appendTo($w);
          $('<div class="slx-added-src">').text(w.src || (w.file && w.file.name + ' (selected file, kept with your settings)') || '').appendTo($w);
          $('<button type="button" class="slx-dialog-btn">').text('Remove').on('click', function () {
            remove(w.name);
            draw();
          }).appendTo($w);
        });
      });
      $('<p class="slx-dialog-hint">').text('A removed widget\'s open panels keep working until the app is next opened.').appendTo($b);
    }
    draw();
    dialog('Added widgets', $b);
  }

  Sienna.addedWidgets = {
    /** What is remembered, as stored (copies). */
    list: function () { return JSON.parse(JSON.stringify(store.widgets)); },
    toolkits: function () { return JSON.parse(JSON.stringify(store.toolkits)); },

    /** Add from `{ url }` or `{ files }`, CONSENT ALREADY GIVEN. Resolves to what was added. */
    add: add,
    remove: remove,

    /** Called after any change to the set (so an app re-draws its menu). */
    onChange: function (fn) { listeners.push(fn); },

    /** The dialogs, for an app that offers them somewhere other than menuItems. */
    addDialog: function () { addDialog('widget'); },
    addToolkitDialog: function () { addDialog('toolkit'); },
    manageDialog: manageDialog,

    /**
     * The end of an app's Widgets menu: the added widgets, then the commands.
     * `open(w)` opens one (w is `widgetRegistry.list()`'s entry); by default a
     * panel for the current document, if the app has documents.
     */
    menuItems: function (app, open) {
      open = open || function (w) {
        var docs = Sienna.documents;
        var ref = docs && docs.isConfigured() ? (docs.current(app) || '') : '';
        app.addPanel({ title: w.title, widget: w.name, options: w.options, ref: ref });
      };
      var mine = reg.list().filter(function (w) { return w.external; }).map(function (w) {
        return { label: w.label, onSelect: function () { open(w); } };
      });
      return [{ separator: true }].concat(mine, [
        { label: 'Add a widget…', onSelect: function () { addDialog('widget'); } },
        { label: 'Add a toolkit…', onSelect: function () { addDialog('toolkit'); } },
        { label: 'Manage added widgets…', onSelect: manageDialog },
      ]);
    },
  };
})(window.jQuery, window.Sienna);
