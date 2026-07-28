/**
 * `Sienna.files` — tiny shared helpers for file interchange under `file://`,
 * where the browser cannot write files silently. `download` triggers a Blob
 * download; `pickFile` opens a file chooser and hands back the parsed JSON.
 *
 * Used by the model layer (export/import a model) and the session log
 * (export/import the action log). Both are overridable/stubbable for tests.
 *
 * Classic script, plain JS. Load before anything that saves/loads files.
 */
(function (Sienna) {
  'use strict';

  Sienna.files = {
    /** Download `obj` as pretty-printed JSON named `filename`. */
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
      } catch (e) {
        /* download unavailable — ignore */
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
