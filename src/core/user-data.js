/**
 * `Sienna.userData` — the single global container for all user data.
 *
 * It is a plain nested object addressed by **path strings** ('models/graph-2',
 * 'models/graph-2/count'). The framework never knows what properties exist;
 * application code decides the shape (e.g. a `models` map plus a shared
 * `ontology`). A panel's `ref` is exactly such a path into here.
 *
 * Every mutation (`set`/`update`/`remove`/`fromJSON`) does three things:
 *   1. changes the in-memory tree,
 *   2. **autosaves** the whole store to localStorage (guarded, works on file://)
 *      under `sienna.userData.v1` — separate from the workspace/session slot,
 *   3. emits a change `{ type, ref, value, prior }` to matching subscribers.
 *
 * `subscribe(refPrefix, fn)` is the substrate a future pub/sub layer will use:
 * a change notifies a subscriber when the change path and the watched path lie
 * on the same root-to-node line (either contains the other), so watching
 * 'models/graph-2' hears changes at, above, or below it.
 *
 * Design notes:
 *   - Values are stored **by reference**, not cloned. The contract is: mutate
 *     data only through `set`/`update`/`remove`; never mutate a value returned
 *     by `get` in place (that would bypass persistence, events, and undo).
 *   - Intermediate objects are auto-created on `set` ('a/b/c' makes a, b).
 *   - Classic script, plain JS (no jQuery). Load after `persistence.js`.
 */
(function (Sienna) {
  'use strict';

  // Namespaced per application — see `namespace.js` for why every file:// page
  // sharing one origin makes that necessary.
  var KEY = Sienna.storageKey('userData.v1');

  var data = {}; // the whole store
  var subs = []; // [{ prefix, fn }]
  var batching = 0; // >0 while inside batch(): defer the localStorage write
  var batchDirty = false;

  // ---- path helpers ----

  function segs(ref) {
    if (ref == null || ref === '') return [];
    return String(ref)
      .split('/')
      .filter(function (s) {
        return s.length;
      });
  }

  function norm(ref) {
    return segs(ref).join('/');
  }

  // Resolve a path to its value, or undefined if any segment is missing.
  function nodeAt(ps) {
    var cur = data;
    for (var i = 0; i < ps.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      if (!Object.prototype.hasOwnProperty.call(cur, ps[i])) return undefined;
      cur = cur[ps[i]];
    }
    return cur;
  }

  // True when change path `a` and watched path `b` lie on one root-to-node line
  // (equal, or one is an ancestor of the other). '' (root) matches everything.
  function onSameLine(a, b) {
    if (a === '' || b === '') return true;
    if (a === b) return true;
    return a.indexOf(b + '/') === 0 || b.indexOf(a + '/') === 0;
  }

  // ---- persistence ----

  function persist() {
    if (batching > 0) {
      batchDirty = true;
    } else {
      Sienna.persistence.writeJSON(KEY, data);
    }
  }

  function emit(change) {
    for (var i = 0; i < subs.length; i++) {
      if (onSameLine(change.ref, subs[i].prefix)) {
        try {
          subs[i].fn(change);
        } catch (e) {
          /* a bad subscriber must not break the mutation */
        }
      }
    }
    persist();
  }

  Sienna.userData = {
    // ---- read ----

    /** @param {string} [ref] path ('' or omitted => whole store) */
    get: function (ref) {
      return nodeAt(segs(ref));
    },

    /** @returns {boolean} whether a value exists at `ref` */
    has: function (ref) {
      var ps = segs(ref);
      if (!ps.length) return true; // root always exists
      var parent = nodeAt(ps.slice(0, -1));
      return (
        parent != null &&
        typeof parent === 'object' &&
        Object.prototype.hasOwnProperty.call(parent, ps[ps.length - 1])
      );
    },

    /** @returns {string[]} child keys of the object at `ref` (else []) */
    keys: function (ref) {
      var v = nodeAt(segs(ref));
      return v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v)
        : [];
    },

    // ---- write (the only mutation entry points) ----

    /**
     * Set the value at `ref`, creating intermediate objects as needed.
     * @returns the prior value at `ref` (for undo)
     */
    set: function (ref, value) {
      var ps = segs(ref);
      if (!ps.length) {
        var priorRoot = data;
        data = value && typeof value === 'object' ? value : {};
        emit({ type: 'set', ref: '', value: data, prior: priorRoot });
        return priorRoot;
      }
      var parent = data;
      for (var i = 0; i < ps.length - 1; i++) {
        var k = ps[i];
        if (parent[k] == null || typeof parent[k] !== 'object') parent[k] = {};
        parent = parent[k];
      }
      var key = ps[ps.length - 1];
      var prior = parent[key];
      parent[key] = value;
      emit({ type: 'set', ref: ps.join('/'), value: value, prior: prior });
      return prior;
    },

    /**
     * Shallow-merge `patch` into the object at `ref` (one change).
     * @returns the prior value at `ref`
     */
    update: function (ref, patch) {
      var cur = nodeAt(segs(ref));
      var base = cur && typeof cur === 'object' ? cur : {};
      return this.set(ref, Object.assign({}, base, patch));
    },

    /**
     * Delete the value at `ref`.
     * @returns the prior value (or undefined if nothing was there)
     */
    remove: function (ref) {
      var ps = segs(ref);
      if (!ps.length) {
        var priorRoot = data;
        data = {};
        emit({ type: 'remove', ref: '', value: undefined, prior: priorRoot });
        return priorRoot;
      }
      var parent = nodeAt(ps.slice(0, -1));
      var key = ps[ps.length - 1];
      if (
        parent == null ||
        typeof parent !== 'object' ||
        !Object.prototype.hasOwnProperty.call(parent, key)
      ) {
        return undefined;
      }
      var prior = parent[key];
      delete parent[key];
      emit({ type: 'remove', ref: ps.join('/'), value: undefined, prior: prior });
      return prior;
    },

    /**
     * Run `fn` with a single deferred localStorage write at the end (change
     * events still fire per mutation). `fn` is synchronous.
     * @returns fn's return value
     */
    batch: function (fn) {
      batching++;
      try {
        return fn();
      } finally {
        batching--;
        if (batching === 0 && batchDirty) {
          batchDirty = false;
          Sienna.persistence.writeJSON(KEY, data);
        }
      }
    },

    // ---- observe (pub/sub substrate) ----

    /**
     * @param {string} refPrefix path region to watch ('' = whole store)
     * @param {(change: {type, ref, value, prior}) => void} fn
     * @returns {() => void} unsubscribe
     */
    subscribe: function (refPrefix, fn) {
      var entry = { prefix: norm(refPrefix), fn: fn };
      subs.push(entry);
      return function () {
        var i = subs.indexOf(entry);
        if (i >= 0) subs.splice(i, 1);
      };
    },

    // ---- file interchange (deep copies; whole store or a subtree) ----

    /** @returns a deep clone of the value at `ref` (undefined if absent) */
    toJSON: function (ref) {
      var v = nodeAt(segs(ref));
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },

    /** Replace the value at `ref` with a deep copy of `obj` (persists, emits). */
    fromJSON: function (ref, obj) {
      return this.set(ref, JSON.parse(JSON.stringify(obj)));
    },

    // ---- storage lifecycle ----

    /**
     * Re-read the whole store from localStorage (silent; no events).
     *
     * ADOPTS pre-namespacing data once: when an app declares an id for the
     * first time, its store is still sitting under the old shared key, and
     * without this everything a user has built would appear to vanish. The old
     * slot is copied, not moved — left where it is, so rolling back to a build
     * without namespacing still finds it. Only ever done when the app's own
     * slot is empty, so it cannot overwrite anything.
     */
    load: function () {
      var loaded = Sienna.persistence.readJSON(KEY);
      if (!loaded && Sienna.appId) {
        var legacy = Sienna.persistence.readJSON(Sienna.legacyStorageKey('userData.v1'));
        if (legacy && typeof legacy === 'object') {
          loaded = legacy;
          Sienna.persistence.writeJSON(KEY, legacy);
        }
      }
      data = loaded && typeof loaded === 'object' ? loaded : {};
      return data;
    },

    /** Wipe the store and its persisted slot (silent). */
    clear: function () {
      data = {};
      Sienna.persistence.removeKey(KEY);
    },
  };

  // Load any persisted user data at startup.
  Sienna.userData.load();
})(window.Sienna);
