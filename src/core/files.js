/**
 * `Sienna.files` — shared helpers for file interchange, including under
 * `file://` where a page may not write to disk of its own accord.
 *
 * Two ways out, and the difference matters:
 *
 *   `saveAs(filename, obj)`  the **File System Access API** — a real Save
 *                            dialog, and it hands back a HANDLE.
 *   `download(filename, obj)` a Blob download, which cannot overwrite: every
 *                            save makes `model.json`, `model (1).json`, …
 *
 * The handle is the whole point. The security model was never "a page may not
 * write files"; it is "a page may not write files the USER did not choose". A
 * handle is that choice, made in the browser's own dialog, and it can be
 * written through again without further prompting — which is what makes a real
 * **Save**, as against Save As, possible at all. This works under `file://`;
 * it is proven by webAKT, which does exactly this.
 *
 * The catch is reach: the API is Chromium-only. So `saveAs` feature-detects and
 * falls back to `download`, and callers must cope with getting no handle back —
 * in Firefox and Safari every save stays a download, as before.
 *
 * Used by the document layer (save/open a document) and the session log.
 * Stubbable in tests.
 *
 * Classic script, plain JS. Load before anything that saves/loads files.
 */
(function (Sienna) {
  'use strict';

  Sienna.files = {
    /** Is a real Save dialog available, or only a download? */
    canSaveAs: function () {
      return typeof window.showSaveFilePicker === 'function';
    },

    /**
     * Save `obj` through a real Save dialog where the browser has one, else by
     * download.
     *
     * Three outcomes worth telling apart, so the answer carries all three
     * rather than a bare handle: it was written (and through what, if
     * anything, it can be written again); the user cancelled, which is an
     * ordinary act and not a failure; or the browser refused the download,
     * which the caller must report or the save vanishes in silence.
     *
     * @returns {Promise<{handle: object|null, written: boolean, cancelled: boolean}>}
     */
    saveAs: function (filename, obj) {
      if (!this.canSaveAs()) {
        return Promise.resolve({
          handle: null,
          written: this.download(filename, obj),
          cancelled: false,
        });
      }
      var self = this;
      return window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      }).then(function (handle) {
        return self.writeTo(handle, obj).then(function () {
          return { handle: handle, written: true, cancelled: false };
        });
      }).catch(function (e) {
        if (e && e.name === 'AbortError') {
          return { handle: null, written: false, cancelled: true };
        }
        throw e;
      });
    },

    /**
     * Write `obj` through a handle already granted — the second and later
     * saves of a document. Rejects if the grant has lapsed, which the caller
     * should answer by falling back to `saveAs`.
     *
     * @returns {Promise<void>}
     */
    writeTo: function (handle, obj) {
      return handle.createWritable().then(function (writable) {
        return writable.write(JSON.stringify(obj, null, 2)).then(function () {
          return writable.close();
        });
      });
    },

    /**
     * Download `obj` as pretty-printed JSON named `filename`. The fallback
     * path, and the only one on Firefox and Safari.
     * @returns {boolean} whether the download was started
     */
    download: function (filename, obj) {
      try {
        var blob = new Blob([JSON.stringify(obj, null, 2)], {
          type: 'application/json',
        });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 0);
        return true;
      } catch (e) {
        // Was silent, which left a failed save indistinguishable from a
        // successful one. Report it and let the caller tell the user.
        return false;
      }
    },

    /** Open a JSON file chooser; call `cb(parsed)` on a valid selection. */
    pickFile: function (cb) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            cb(JSON.parse(String(reader.result)));
          } catch (e) {
            /* bad file — ignore */
          }
        };
        reader.readAsText(file);
      });
      input.click();
    },
  };
})(window.Sienna);
