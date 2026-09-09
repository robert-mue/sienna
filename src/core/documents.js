/**
 * `Sienna.documents` — the shell's document layer, and the File menu built on
 * it.
 *
 * The shell is a host: one `index.html` that becomes a particular application
 * (`?app=simile`, `?app=webakt`) by loading that app's widgets and its notion
 * of user data. What does NOT vary is the conventional furniture a user
 * expects along the top — and **File is part of that furniture**. So the shell
 * owns New / Open / Save / Save As / the list of open documents, and an app
 * customises only what it must.
 *
 * That "must" is small but real. Three things cannot be generic, so they are
 * registered rather than assumed:
 *
 *   - `create(id)` — what an EMPTY document of this app looks like. A shell
 *     cannot know that simile's is three id-keyed maps plus layout.
 *   - `widget` — which widget opens a document in a panel.
 *   - `geometry` — the size that panel should OPEN at. The panel default
 *     (260px wide, height from content) is sized for a small tool panel, and a
 *     document widget is not one: simile's diagram widget wraps its toolbar
 *     into six rows at that width, so the furniture is taller than the canvas.
 *     Only the app knows what its own document wants to be seen at. Optional,
 *     and omitting it keeps the panel default, so this changes nothing for an
 *     app that does not set it.
 *
 * Everything else is generic: documents live at `<root>/<id>` in `userData`,
 * are saved as pretty JSON via `Sienna.files`, and are read back via
 * `Sienna.files.pickFile`, both of which exist because a page may not read or
 * write a file the user has not chosen.
 *
 * **Save vs Save as.** `saveAs` asks the user for a file and REMEMBERS it, so
 * `save` can write straight back to it — a real Save, not a fresh download
 * each time. That rests on the File System Access API, which is Chromium-only,
 * so where it is absent both degrade to a download and Save means Save as.
 * Handles live in memory only; see `saveAs` for why they are not persisted.
 *
 * Deliberately NOT here: what a document MEANS. The shell moves whole values in
 * and out of `userData` and never inspects them, so the app keeps sole
 * authority over its own shape — which is the same boundary `userData` itself
 * draws.
 *
 * Classic script, plain JS. Load after `user-data.js`, `files.js` and
 * `actions.js`, before `app.js`.
 */
(function (Sienna) {
  'use strict';

  var config = {
    root: 'documents',
    label: 'document',
    labelPlural: null,   // only where adding 's' is wrong
    widget: null,
    geometry: null,
    create: null,
    validate: null,
    extraItems: null,    // () => menu items, appended to File before Recent
    recentMax: 10,
    panelTitle: null,    // (doc, app) => string, names a document's panel
  };

  /**
   * File handles granted by the user, keyed by document path — what makes a
   * real Save possible (see `saveAs`). In memory only, so they last as long as
   * the page does and no longer.
   */
  var handles = Object.create(null);

  function path(id) {
    return config.root + '/' + id;
  }

  /** A free id under the configured root, based on a preferred name. */
  function freeId(preferred) {
    var base = String(preferred || config.label).replace(/[^A-Za-z0-9_-]/g, '') || 'doc';
    var id = base;
    var n = 1;
    while (Sienna.userData.get(path(id))) { n++; id = base + n; }
    return id;
  }

  /**
   * The recently-opened list, newest first, as ids under `config.root`.
   *
   * Stored beside the documents rather than in them, at `recent/<root>`, so it
   * survives a reload and so `exportAll` — which bundles the root and nothing
   * else — does not carry a menu's history into a backup. Written straight to
   * `userData`, never dispatched: opening a document is navigation, and an
   * undo that silently re-ordered a menu would be a strange thing to offer.
   *
   * Read filters out ids that no longer exist, so a deleted document leaves no
   * dead entry behind, and the stored list is only pruned when something is
   * opened. That keeps reading cheap and side-effect-free.
   */
  function recentKey() {
    return 'recent/' + config.root;
  }

  function recentIds() {
    var raw = Sienna.userData.get(recentKey());
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (id) {
      return typeof id === 'string' && !!Sienna.userData.get(path(id));
    });
  }

  function touchRecent(docPath) {
    if (!docPath || docPath.indexOf(config.root + '/') !== 0) return;
    var id = docPath.slice(config.root.length + 1);
    var list = recentIds().filter(function (x) { return x !== id; });
    list.unshift(id);
    Sienna.userData.set(recentKey(), list.slice(0, config.recentMax));
  }

  /**
   * THE CURRENT DOCUMENT — which one a command with no other subject acts on.
   *
   * It used to be implicit: whichever bound panel was frontmost. That reads the
   * user's mind correctly most of the time and cannot answer at all the rest,
   * because a widget with no document panel of its own — a simulation's
   * transport, a plot — has no frontmost anything to consult, and a document
   * with every panel closed stops existing as far as the question goes.
   *
   * So it is stored, at `current/<root>`, and moved by everything that plainly
   * means "I am working on this now": creating, opening, and bringing a bound
   * panel to the front. The explicit File command is for saying so when none of
   * those has happened. Frontmost is still the fallback, for a store that has
   * never recorded one.
   */
  function currentKey() {
    return 'current/' + config.root;
  }

  Sienna.documents = {
    /**
     * An app declares itself here. Everything is optional except that opening
     * a document needs a `widget` and creating one needs `create`.
     *
     * @param {{root?:string, label?:string, labelPlural?:string, widget?:string,
     *          geometry?:{left?:number, top?:number, width?:number, height?:number},
     *          create?:(id:string)=>object, validate?:(obj:object)=>void,
     *          extraItems?:()=>Array, recentMax?:number,
     *          panelTitle?:(doc:object, app:object)=>string}} opts
     */
    configure: function (opts) {
      Object.assign(config, opts || {});
      return this;
    },

    /** Has an app declared its documents? The File menu depends on it. */
    isConfigured: function () {
      return !!(config.widget || config.create);
    },

    /** `[{ id, path, name }]` for every document in the store. */
    list: function () {
      return Sienna.userData.keys(config.root).map(function (id) {
        var doc = Sienna.userData.get(path(id)) || {};
        return { id: id, path: path(id), name: doc.name || id };
      });
    },

    /** Create an empty document and return its path. */
    create: function (preferred) {
      if (typeof config.create !== 'function') {
        throw new Error('No document factory registered: call Sienna.documents.configure({ create }).');
      }
      var id = freeId(preferred || config.label);
      var doc = config.create(id);
      Sienna.actions.dispatch(
        { type: 'documents.create', target: path(id), payload: { id: id } },
        function () { Sienna.userData.set(path(id), doc); }
      );
      return path(id);
    },

    /**
     * Take a parsed file into the store as a new document. The id is re-derived
     * from the free path it lands at rather than trusted from the file, so two
     * files saved from one original cannot collide.
     */
    import: function (obj) {
      if (!obj || typeof obj !== 'object') throw new Error('Not a document file.');
      if (typeof config.validate === 'function') config.validate(obj);
      var id = freeId(obj.id || config.label);
      Sienna.actions.dispatch(
        { type: 'documents.import', target: path(id), payload: { id: id, name: obj.name || id } },
        function () {
          Sienna.userData.fromJSON(path(id), Object.assign({}, obj, { id: id }));
        }
      );
      return path(id);
    },

    /**
     * Save a document to a file the user chooses, and REMEMBER the file, so
     * that `save` can afterwards write straight back to it.
     *
     * Handles are held in memory only, keyed by document path. Persisting them
     * (IndexedDB can store a handle across sessions, at the price of a
     * permission prompt on the next visit) is deliberately not done yet: it
     * would mean a document silently remembering a file from a previous day,
     * which wants thinking about before it is built.
     *
     * @returns {Promise<{written: boolean, cancelled: boolean}>}
     */
    saveAs: function (docPath) {
      var doc = Sienna.userData.toJSON(docPath);
      if (!doc) return Promise.resolve({ written: false, cancelled: false });
      var name = (doc.name || doc.id || 'document') + '.json';
      return Sienna.files.saveAs(name, doc).then(function (r) {
        if (r.handle) handles[docPath] = r.handle;
        return { written: r.written, cancelled: r.cancelled };
      });
    },

    /**
     * Write EVERY stored document to one file — a backup, not a save.
     *
     * The gap this fills is not convenience. Documents live in `userData`,
     * which lives in localStorage, which lives on one machine in one browser
     * profile: no repository holds them, and a per-document Save as is a chore
     * nobody performs often enough to be a backup. One command that writes the
     * lot is the difference between "my work is safe" and "my work was safe as
     * of whenever I last remembered".
     *
     * Deliberately NOT paired with an import yet. Reading a bundle back has to
     * answer what happens to a document of the same id that already exists, and
     * the wrong answer silently destroys work — the one thing this command
     * exists to prevent. Left to be designed rather than guessed.
     *
     * @returns {Promise<{written: boolean, cancelled: boolean, count: number}>}
     */
    exportAll: function () {
      var all = Sienna.userData.toJSON(config.root) || {};
      var ids = Object.keys(all);
      var stamp = new Date().toISOString().slice(0, 10);
      var name = (Sienna.appId || config.root) + '-' + config.root + '-' + stamp + '.json';
      // Wrapped rather than bare, so a reader can tell a bundle of documents
      // from a single one without guessing, and can see what it was a bundle OF.
      return Sienna.files.saveAs(name, {
        kind: 'sienna.documents.bundle',
        root: config.root,
        savedAt: new Date().toISOString(),
        count: ids.length,
        documents: all,
      }).then(function (r) {
        return { written: r.written, cancelled: r.cancelled, count: ids.length };
      });
    },

    /**
     * Save a document back to the file it came from, falling back to `saveAs`
     * when there is no such file — the first save, a browser with no File
     * System Access API, or a grant that has lapsed since.
     *
     * @returns {Promise<{written: boolean, cancelled: boolean}>}
     */
    save: function (docPath) {
      var doc = Sienna.userData.toJSON(docPath);
      if (!doc) return Promise.resolve({ written: false, cancelled: false });
      var handle = handles[docPath];
      if (!handle) return this.saveAs(docPath);
      var self = this;
      return Sienna.files.writeTo(handle, doc)
        .then(function () { return { written: true, cancelled: false }; })
        .catch(function () {
          // The grant is gone (revoked, or the file moved). Ask again rather
          // than report a failure the user can do nothing with.
          delete handles[docPath];
          return self.saveAs(docPath);
        });
    },

    /** Has this document a file to save straight back to? */
    hasFile: function (docPath) {
      return !!handles[docPath];
    },

    /** Open a document in a panel, using the app's registered widget. */
    open: function (app, docPath, title) {
      if (!config.widget) throw new Error('No document widget registered.');
      var doc = Sienna.userData.get(docPath) || {};
      // `ref` is the shell's own binding: the path a panel is a view of. Using
      // it means the widget gets _model()/_watchModel for free, several panels
      // can share one document, and File commands can find the current one
      // without knowing anything about the widget.
      // `geometry` is passed only when the app asked for one: addPanel treats
      // an absent geometry and an undefined one differently from a partial
      // object, and the panel default must survive an app that never set it.
      // An app may name its panels itself: a workspace with several documents
      // open in several kinds of widget needs a title that says which is which,
      // and only the app knows what its scheme is.
      var named = typeof config.panelTitle === 'function'
        ? config.panelTitle({ id: docPath.split('/').pop(), path: docPath, name: doc.name }, app)
        : null;
      var cfg = {
        title: named || title || doc.name || docPath.split('/').pop(),
        widget: config.widget,
        ref: docPath,
      };
      if (config.geometry) {
        cfg.geometry = Object.assign({}, config.geometry);
        // The size a document opens at is also the size it should re-open to
        // from a thumbnail — one answer to "how big should this be?", not two.
        cfg.workingSize = { width: config.geometry.width, height: config.geometry.height };
      }
      app.addPanel(cfg);
      touchRecent(docPath);
      this.setCurrent(docPath);
    },

    /**
     * The current document's path, or null. The stored choice wins as long as
     * it still names something; failing that, the frontmost bound panel.
     * @param {object} [app] only needed for the frontmost fallback
     */
    current: function (app) {
      var id = Sienna.userData.get(currentKey());
      if (typeof id === 'string' && Sienna.userData.get(path(id))) return path(id);
      return app ? this.frontmostPath(app) : null;
    },

    /**
     * Make `docPath` current. Written straight to `userData`, never dispatched:
     * this is navigation, and an undo that silently retargeted the Run controls
     * would be a strange thing to offer. A no-op when nothing changes, so that
     * raising the same panel twice does not churn the store or the menu.
     */
    setCurrent: function (docPath) {
      if (!docPath || docPath.indexOf(config.root + '/') !== 0) return;
      var id = docPath.slice(config.root.length + 1);
      if (!Sienna.userData.get(path(id))) return;
      if (Sienna.userData.get(currentKey()) === id) return;
      Sienna.userData.set(currentKey(), id);
    },

    /** `[{ id, path, name }]` for the recently opened, newest first. */
    recent: function () {
      return recentIds().map(function (id) {
        var doc = Sienna.userData.get(path(id)) || {};
        return { id: id, path: path(id), name: doc.name || id };
      });
    },

    /**
     * The File menu, ready for the menu bar. The app never builds these items;
     * it only registers what makes them app-specific.
     */
    menuItems: function (app) {
      var self = this;
      var items = [
        {
          label: 'New ' + config.label,
          onSelect: function () { self.open(app, self.create()); },
        },
        {
          label: 'Open ' + config.label + ' file…',
          onSelect: function () {
            Sienna.files.pickFile(function (obj) {
              try {
                self.open(app, self.import(obj));
              } catch (e) {
                window.alert('Could not open that file: ' + e.message);
              }
            });
          },
        },
        // Save writes straight back to the file the document came from, asking
        // for one the first time. On a browser with no File System Access API
        // there is no such file, so it degrades to Save as — both entries then
        // download. Both are listed everywhere all the same: a menu that
        // changes shape between browsers is harder to describe than one
        // command that quietly does less.
        {
          label: 'Save ' + config.label,
          onSelect: function () { withCurrent('save'); },
        },
        {
          label: 'Save ' + config.label + ' as file…',
          onSelect: function () { withCurrent('saveAs'); },
        },
        // The backup. Listed even when there is nothing to back up, because a
        // command that appears only once you have something to lose is one you
        // learn about too late.
        {
          label: 'Export all ' + plural() + '…',
          onSelect: function () {
            self.exportAll().then(function (r) {
              if (r.cancelled) return;
              if (!r.written) {
                window.alert('Could not write the file: the browser refused.');
                return;
              }
              window.alert('Exported ' + r.count + ' ' + (r.count === 1 ? config.label : plural()) + '.');
            }).catch(function (e) {
              window.alert('Could not export: ' + (e && e.message ? e.message : e));
            });
          },
        },
      ];

      /** `label` pluralised: an app may say so itself where adding 's' is wrong. */
      function plural() {
        return config.labelPlural || config.label + 's';
      }

      /**
       * Run a save command on the frontmost document, and say so when it does
       * not happen. Never fail silently: a command that does nothing, with no
       * reason given, is indistinguishable from a broken one.
       */
      function withCurrent(method) {
        var p = self.current(app);
        if (!p) {
          window.alert('No ' + config.label + ' to save — open one first.');
          return;
        }
        self[method](p).then(function (r) {
          if (r.written || r.cancelled) return;   // cancelling is not a failure
          window.alert('Could not save the ' + config.label + ': the browser refused.');
        }).catch(function (e) {
          window.alert('Could not save: ' + (e && e.message ? e.message : e));
        });
      }

      // Whatever else the app puts in File — formats belonging to some other
      // program, typically. It comes after the shell's own commands and before
      // the document lists, which is where a user looks for "and this other
      // kind of file too".
      var extra = typeof config.extraItems === 'function' ? config.extraItems() : null;
      if (extra && extra.length) {
        items.push({ label: '—' });
        extra.forEach(function (it) { items.push(it); });
      }

      // Two lists, and they are NOT the same list shortened. `Recent` is the
      // conventional handful you were last working on, in the order you last
      // touched them. `All` is every stored document — needed because the
      // store is the only copy there is, so a document must never become
      // unreachable just by being old. A flat list of everything used to sit
      // at the foot of this menu; at seventeen models that is not a menu.
      var docs = this.list();
      if (docs.length) {
        items.push({ label: '—' });

        // Saying which one is current, and letting it be said. The marker is
        // the only place the concept is visible at all until a panel's titlebar
        // shows it, and a list where nothing is ticked would leave the user
        // guessing what the commands above act on.
        var cur = this.current(app);
        items.push({
          label: 'Current ' + config.label,
          items: byName(docs).map(function (doc) {
            return {
              label: (doc.path === cur ? '• ' : '\u2007 ') + doc.name,
              onSelect: function () { self.setCurrent(doc.path); },
            };
          }),
        });

        var recent = this.recent();
        items.push({
          label: 'Recent',
          items: recent.length
            ? recent.map(openItem)
            : [{ label: '(nothing opened yet)' }],
        });

        items.push({
          label: 'All ' + plural(),
          items: byName(docs).map(openItem),
        });
      }

      /** A copy in name order — store order is arrival order, which is no order. */
      function byName(list) {
        return list.slice().sort(function (a2, b2) { return a2.name.localeCompare(b2.name); });
      }

      function openItem(doc) {
        return {
          label: doc.name,
          onSelect: function () { self.open(app, doc.path, doc.name); },
        };
      }

      return items;
    },

    /**
     * The document the FRONTMOST bound panel is viewing. A panel's `ref` is
     * exactly that path, so this needs no knowledge of any widget — but a
     * widget that views a document must set its panel's `ref`, or the shell
     * cannot see it (widget-base does this for a widget opened with a `path`
     * option).
     *
     * Frontmost is by stacking order, so this is the panel last raised. Used as
     * the fallback for `current`, and no longer consulted directly: raising a
     * panel now makes its document current, so the two agree.
     */
    frontmostPath: function (app) {
      var best = null;
      var bestZ = -Infinity;
      $('.slx-panel').each(function () {
        var ref = $(this).panel('ref');
        if (!ref || !Sienna.userData.get(ref)) return;
        var z = parseInt($(this).css('z-index'), 10);
        if (isNaN(z)) z = 0;
        if (z >= bestZ) { bestZ = z; best = ref; }
      });
      return best;
    },
  };
})(window.Sienna);
