/**
 * localStorage persistence, exposed as `Sienna.persistence`.
 *
 * Provides generic guarded JSON slots (`readJSON`/`writeJSON`/`removeKey`) used
 * by any module that needs to persist under `file://`, plus the workspace's own
 * `save`/`load`/`clear` (the array from `workspace('serialize')`) as thin
 * wrappers. All access is guarded so a disabled/full/corrupt store (or a browser
 * that restricts storage on file://) degrades to "no persistence" rather than
 * throwing.
 */
(function (Sienna) {
  'use strict';

  var KEY = 'sienna.workspace.v1';

  Sienna.persistence = {
    /** Guarded `JSON.stringify` write to an arbitrary key. */
    writeJSON: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable or full — ignore */
      }
    },

    /** Guarded read + parse; returns `null` on missing/corrupt/unavailable. */
    readJSON: function (key) {
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /** Guarded key removal. */
    removeKey: function (key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        /* ignore */
      }
    },

    // --- workspace session slot (the serialised panel array) ---
    save: function (state) {
      this.writeJSON(KEY, state);
    },

    load: function () {
      var parsed = this.readJSON(KEY);
      return Array.isArray(parsed) ? parsed : null;
    },

    clear: function () {
      this.removeKey(KEY);
    },
  };
})(window.Sienna);
