/**
 * Global namespace for sienna.
 *
 * This app runs as plain classic <script> tags (so it works by opening
 * index.html directly via file://, with no server or build step). There are no
 * ES module imports/exports — modules communicate through this single global.
 *
 * It also settles the **application id**, because two things downstream need it
 * before anything else happens — `persistence` and `userData` both name a
 * localStorage key at load time, and `userData` reads its store on the way in.
 *
 * Why an id is needed at all: **every `file://` page shares one origin.**
 * `location.origin` is literally `"file://"`, and a page in one directory can
 * read what a page in another wrote — measured on Chrome 149, for both
 * localStorage and IndexedDB. Since sienna is a host that becomes a particular
 * application (§18 of simile's DESIGN-diagram), two sienna apps opened from
 * disk would otherwise share `sienna.userData.v1` and silently overwrite each
 * other's models. Served over http the problem evaporates, each origin being
 * distinct; it bites in exactly the mode sienna is built for.
 *
 * The id is taken from, in order:
 *   1. `window.SIENNA_APP`, set by the host page before these scripts load;
 *   2. `?app=` in the query string (§18's switch, when one host serves several);
 *   3. nothing — in which case the legacy un-namespaced keys are used, so an
 *      app that has not declared itself keeps working and keeps its data.
 */
window.Sienna = window.Sienna || {};

(function (Sienna) {
  'use strict';

  function fromQuery() {
    try {
      var m = /[?&]app=([A-Za-z0-9_-]+)/.exec(window.location.search || '');
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  }

  var declared = typeof window.SIENNA_APP === 'string' && window.SIENNA_APP
    ? window.SIENNA_APP
    : fromQuery();

  /** The application id, or null when the host has not declared one. */
  Sienna.appId = declared && /^[A-Za-z0-9_-]+$/.test(declared) ? declared : null;

  /**
   * The storage key an app should use for a given slot.
   *
   * `storageKey('userData.v1')` → `sienna.simile.userData.v1` when an id is
   * declared, and `sienna.userData.v1` when none is — the legacy name, so
   * existing stores are found where they already are.
   */
  Sienna.storageKey = function (slot) {
    return Sienna.appId ? 'sienna.' + Sienna.appId + '.' + slot : 'sienna.' + slot;
  };

  /** The pre-namespacing name of a slot, for one-time adoption of old data. */
  Sienna.legacyStorageKey = function (slot) {
    return 'sienna.' + slot;
  };
}(window.Sienna));
