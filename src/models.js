/**
 * `Sienna.models` — the application's thin model layer over `Sienna.userData`.
 *
 * This is the ONE place that knows user data is organised as a `models` map;
 * the generic core (`user-data.js`) only ever speaks path strings. A "model" is
 * one entry at `userData` path `models/<id>`, shaped `{ id, name, … }` (app
 * content lives alongside). A panel's `ref` is such a path.
 *
 * localStorage is the live, autosaved store (via userData), so there is no
 * "Save" — durability is continuous. This layer adds model *lifecycle* (new,
 * copy, remove, rename), a notion of the *current* model, and *file*
 * import/export via the shared `Sienna.files` helpers (Blob download +
 * <input type=file>, because file:// forbids silent writes).
 *
 * Classic script, plain JS. Load after `user-data.js` and `files.js`, before
 * `main.js`.
 */
(function (Sienna) {
  'use strict';

  var U = Sienna.userData;
  var current = null; // ref of the active model, or null

  // Mint a fresh model id ('m0', 'm1', …) not colliding with existing ones.
  function mintId() {
    var n = 0;
    U.keys('models').forEach(function (k) {
      var m = /^m(\d+)$/.exec(k);
      if (m) n = Math.max(n, Number(m[1]) + 1);
    });
    return 'm' + n;
  }

  function defaultName(id) {
    return 'Model ' + (Number(id.slice(1)) + 1);
  }

  Sienna.models = {
    /** @returns {Array<{id, ref, name}>} the models, in id order */
    list: function () {
      return U.keys('models').map(function (id) {
        var m = U.get('models/' + id) || {};
        return { id: id, ref: 'models/' + id, name: m.name || id };
      });
    },

    /** @returns {string} the userData path for a model id */
    ref: function (id) {
      return 'models/' + id;
    },

    get: function (ref) {
      return U.get(ref);
    },

    // ---- current model ----
    current: function () {
      return current;
    },
    setCurrent: function (ref) {
      current = ref || null;
      return current;
    },

    // ---- lifecycle ----

    /** Create an empty model; becomes current. @returns its ref */
    create: function (name) {
      var id = mintId();
      var ref = 'models/' + id;
      U.set(ref, { id: id, name: name || defaultName(id) });
      current = ref;
      return ref;
    },

    /** Duplicate a model under a new id (Save As); the copy becomes current. */
    copy: function (ref, name) {
      var src = U.toJSON(ref);
      if (!src || typeof src !== 'object') return null;
      var id = mintId();
      var nref = 'models/' + id;
      src.id = id;
      src.name = name || (src.name || id) + ' (copy)';
      U.set(nref, src);
      current = nref;
      return nref;
    },

    rename: function (ref, name) {
      U.update(ref, { name: name });
      return this;
    },

    remove: function (ref) {
      U.remove(ref);
      if (current === ref) current = null;
      return this;
    },

    // ---- file interchange (secondary; localStorage is primary) ----

    /** Download one model as `<name>.json`. */
    exportFile: function (ref) {
      var m = U.get(ref);
      if (!m) return;
      var name = (m.name || ref.replace(/\//g, '-')) + '.json';
      Sienna.files.download(name, U.toJSON(ref));
    },

    /** Pick a .json file and load it as a new model (fresh id); becomes current. */
    importFile: function () {
      Sienna.files.pickFile(function (obj) {
        if (!obj || typeof obj !== 'object') return;
        var id = mintId();
        obj.id = id;
        if (!obj.name) obj.name = defaultName(id);
        U.set('models/' + id, obj);
        current = 'models/' + id;
      });
    },

    /** Download the whole userData store. */
    exportAll: function () {
      Sienna.files.download('sienna-userData.json', U.toJSON('') || {});
    },

    /** Pick a .json file and replace the whole userData store. */
    importAll: function () {
      Sienna.files.pickFile(function (obj) {
        if (!obj || typeof obj !== 'object') return;
        U.fromJSON('', obj);
        current = null;
      });
    },
  };
})(window.Sienna);
