/**
 * localStorage persistence, exposed as `Sienna.persistence`.
 *
 * Provides generic guarded JSON slots (`readJSON`/`writeJSON`/`removeKey`) used
 * by any module that needs to persist under `file://`, plus the workspace's own
 * `save`/`load`/`clear` (the array from `workspace('serialize')`) as thin
 * wrappers. All access is guarded so a disabled/full/corrupt store (or a browser
 * that restricts storage on file://) degrades to "no persistence" rather than
 * throwing.
 *
 * On a page that keeps nothing (`Sienna.ephemeral`, see `namespace.js`) every
 * slot reads as empty and every write is dropped, so nothing built on these
 * slots — userData, the workspace session, an app's own settings — needs to
 * know about it.
 *
 * **One live tab.** An app open in two tabs would have two copies of its
 * store in memory, each written whole over the other's at every change, so
 * work done in one tab vanishes when the other saves. So only one tab of an
 * app writes: the one opened (or reloaded) last. On loading, a tab claims
 * the app's `liveTab` slot; a tab that sees another claim it (the `storage`
 * event, or the slot read before every write, for a tab the browser had
 * put to sleep) stands down — writes nothing more, and covers itself with
 * a notice whose button reloads it, which claims the slot back. Nothing is
 * lost in the hand-over: every change was written as it was made, and the
 * tab taking over reads the store as the other left it. A page that keeps
 * nothing takes no part. `Sienna.persistence.live()` says whether this tab
 * is the live one.
 */
(function (Sienna) {
  'use strict';

  // Namespaced per application — see `namespace.js` for why every file:// page
  // sharing one origin makes that necessary.
  var KEY = Sienna.storageKey('workspace.v1');

  // ---- one live tab (see the header) ----
  var LIVE = Sienna.storageKey('liveTab');
  var me = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  var stoodDown = false;

  function claim() {
    try { localStorage.setItem(LIVE, me); } catch (e) { /* no storage: nothing to guard */ }
  }

  // May this tab write? No once another tab has claimed the app. A slot
  // found empty (wiped, as `?newuser=fresh` does) is claimed again.
  function mayWrite() {
    if (Sienna.ephemeral || stoodDown) return false;
    var owner;
    try { owner = localStorage.getItem(LIVE); } catch (e) { return true; }
    if (owner === null) { claim(); return true; }
    if (owner === me) return true;
    standDown();
    return false;
  }

  function standDown() {
    if (stoodDown) return;
    stoodDown = true;
    var show = function () {
      if (document.querySelector('.slx-elsewhere')) return;
      // The app's name: its tab title, without a new-user preview's prefix (app.js).
      var name = (document.title || 'this app').replace(/^New user — /, '');
      name = name.charAt(0).toUpperCase() + name.slice(1);
      var box = document.createElement('div');
      box.className = 'slx-elsewhere';
      box.setAttribute('role', 'alertdialog');
      box.innerHTML = '<div class="slx-elsewhere-card">'
        + '<p class="slx-elsewhere-head"></p>'
        + '<p>Only one tab at a time can change your work, so that neither '
        + 'overwrites the other. This tab has stopped saving.</p>'
        + '<button type="button" class="slx-elsewhere-use">Use it in this tab</button>'
        + '<p class="slx-elsewhere-note">This tab reloads, with everything as the '
        + 'other tab left it, and the other tab stops instead.</p></div>';
      box.querySelector('.slx-elsewhere-head').textContent = name + ' is open in another tab.';
      box.querySelector('button').addEventListener('click', function () { window.location.reload(); });
      document.body.appendChild(box);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded', show);
  }

  if (!Sienna.ephemeral) {
    claim();
    window.addEventListener('storage', function (e) {
      if (e.key === LIVE && e.newValue !== null && e.newValue !== me) standDown();
    });
  }

  Sienna.persistence = {
    /** Is this the tab that writes (see the header)? False on a page that keeps nothing. */
    live: function () {
      return mayWrite();
    },

    /** Guarded `JSON.stringify` write to an arbitrary key. */
    writeJSON: function (key, value) {
      if (!mayWrite()) return;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable or full — ignore */
      }
    },

    /** Guarded read + parse; returns `null` on missing/corrupt/unavailable. */
    readJSON: function (key) {
      if (Sienna.ephemeral) return null;
      try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },

    /** Guarded key removal. */
    removeKey: function (key) {
      if (!mayWrite()) return;
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
      // Adopt a pre-namespacing session once, as userData does — otherwise the
      // first run after an app declares an id opens with an empty workspace.
      // Only when NOTHING is saved: a session is an object now, not an array,
      // and testing for an array adopted the old one over every new save.
      // Never for a new-user preview, which must start from nothing.
      if (!parsed && Sienna.appId && !Sienna.newUser) {
        var legacy = this.readJSON(Sienna.legacyStorageKey('workspace.v1'));
        if (Array.isArray(legacy)) {
          parsed = legacy;
          this.writeJSON(KEY, legacy);
        }
      }
      // Either the bare panel array older sessions saved, or the object `App`
      // saves now, which carries the top level's own arrangement beside it.
      if (Array.isArray(parsed)) return parsed;
      return parsed && Array.isArray(parsed.panels) ? parsed : null;
    },

    clear: function () {
      this.removeKey(KEY);
    },
  };
})(window.Sienna);
