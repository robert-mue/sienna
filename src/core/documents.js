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
 * That "must" is small but real. Two things cannot be generic, so they are
 * registered rather than assumed:
 *
 *   - `create(id)` — what an EMPTY document of this app looks like. A shell
 *     cannot know that simile's is three id-keyed maps plus layout.
 *   - `widget` — which widget opens a document in a panel.
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
    widget: null,
    create: null,
    validate: null,
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

  Sienna.documents = {
    /**
     * An app declares itself here. Everything is optional except that opening
     * a document needs a `widget` and creating one needs `create`.
     *
     * @param {{root?:string, label?:string, widget?:string,
     *          create?:(id:string)=>object, validate?:(obj:object)=>void}} opts
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
      app.addPanel({
        title: title || doc.name || docPath.split('/').pop(),
        widget: config.widget,
        ref: docPath,
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
      ];

      /**
       * Run a save command on the frontmost document, and say so when it does
       * not happen. Never fail silently: a command that does nothing, with no
       * reason given, is indistinguishable from a broken one.
       */
      function withCurrent(method) {
        var p = self.currentPath(app);
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

      var docs = this.list();
      if (docs.length) {
        items.push({ label: '—' });
        docs.forEach(function (doc) {
          items.push({
            label: doc.name,
            onSelect: function () { self.open(app, doc.path, doc.name); },
          });
        });
      }
      return items;
    },

    /**
     * Which document a File command acts on: the one the FRONTMOST bound panel
     * is viewing. A panel's `ref` is exactly that path, so this needs no
     * knowledge of any widget — but a widget that views a document must set its
     * panel's `ref`, or the shell cannot see it (widget-base does this for a
     * widget opened with a `path` option).
     *
     * Frontmost is by stacking order, so this acts on the panel last raised —
     * what the user means by "this one" when several are open.
     */
    currentPath: function (app) {
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
