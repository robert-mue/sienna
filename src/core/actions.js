/**
 * `Sienna.actions` — the single dispatch point for user actions, and the
 * recorder that turns them into a JSON log (for replay-as-video, UI testing,
 * and a future interactive tutorial).
 *
 * This is the spine of the logging/undo work. Every user action flows through
 * `dispatch(action, run?)`:
 *   - `action` = `{ type, target?, payload? }` — semantic, hand-editable metadata
 *     (e.g. `{ type: 'counter.increment', target: 'p3', payload: { by: 1 } }`).
 *   - `run?` — an optional function performing the effect. While it runs, every
 *     `Sienna.userData` change is captured into the entry's `changes` array
 *     (a userData "transaction"), which is what a later undo layer reverses and
 *     what lets the log audit its own data effects.
 *
 * Recorded entry shape:
 *   { seq, ts, type, target, payload, changes: [{ ref, prior, value }] }
 *
 * Framework code auto-dispatches the interactions it already owns (menu
 * selections, panel add/close/move/resize/min/maximise) so widget authors get
 * those logged for free. Nested dispatches (an action whose `run` triggers
 * another dispatch) attribute their userData changes to the OUTERMOST
 * transaction; the inner entry is still recorded (with empty `changes`).
 *
 * Classic script, plain JS. Load after `user-data.js`, before the widgets that
 * dispatch (`panel`/`workspace`/`menu`).
 */
(function (Sienna) {
  'use strict';

  var log = [];
  var seq = 0;
  var recording = true;
  var subscribers = []; // fn(entry) — observers of the dispatched stream
  var capture = null; // the changes[] currently being filled, or null
  var replayHandlers = {}; // type -> fn(entry): how to re-perform an action

  // Default replay for a data-changing entry: re-apply its captured values.
  /**
   * A detached copy of a recorded value. Primitives pass through untouched, so
   * the common case — a label, a number, a pair of coordinates — costs nothing
   * beyond a typeof.
   */
  function snapshot(v) {
    if (v === null || typeof v !== 'object') return v;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(v); } catch (e) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * Re-apply an entry's captured changes — used by replay, and by undo/redo
   * through the history layer.
   *
   * `snapshot` on the way OUT as well as in, and for the same reason: handing
   * the recorded object itself to `userData` would put the log's own value into
   * the live store, where the next write into that object graph mutates it. The
   * log would then be corrupted BY BEING USED — faithful the first time, wrong
   * every time after. Replaying a log must leave it exactly as it found it.
   */
  function applyChanges(entry) {
    Sienna.userData.batch(function () {
      for (var i = 0; i < entry.changes.length; i++) {
        var c = entry.changes[i];
        if (c.value === undefined) Sienna.userData.remove(c.ref);
        else Sienna.userData.set(c.ref, snapshot(c.value));
      }
    });
  }

  function notify(entry) {
    for (var i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](entry);
      } catch (e) {
        /* a bad observer must not break dispatch */
      }
    }
  }

  Sienna.actions = {
    /**
     * A detached copy of a recorded value — exposed because `history` applies
     * the very same captured changes and must copy them for the same reason
     * (see `applyChanges`).
     */
    snapshot: snapshot,

    /**
     * Dispatch (and record) a user action.
     * @param {{type:string, target?:*, payload?:object}} action
     * @param {Function} [run] effect to perform; its userData changes are captured
     * @returns {object} the recorded entry
     */
    dispatch: function (action, run) {
      var entry = {
        seq: seq++,
        ts: Date.now(),
        type: action.type,
        target: action.target != null ? action.target : null,
        payload: action.payload || {},
        changes: [],
      };

      if (typeof run === 'function') {
        if (capture) {
          // Nested: let the outer transaction capture these changes.
          run();
        } else {
          capture = entry.changes;
          var unsub = Sienna.userData.subscribe('', function (c) {
            // SNAPSHOT, never the live object. `userData` stores values by
            // reference, so a recorded value would otherwise go on changing
            // after it was recorded: writing deeper into the same object graph
            // mutates the very thing the log is holding. The symptom is a log
            // that lies about the past — a recorded "create an empty model"
            // that, by the time you read it, contains the finished model, so
            // replay reproduces the end state at the creating action and every
            // later entry is a no-op. A history must be immutable to be a
            // history.
            capture.push({ ref: c.ref, prior: snapshot(c.prior), value: snapshot(c.value) });
          });
          try {
            Sienna.userData.batch(run); // one persist for the whole action
          } finally {
            unsub();
            capture = null;
          }
        }
      }

      if (recording) {
        log.push(entry);
        notify(entry);
      }
      return entry;
    },

    /** Observe the dispatched stream. @returns {() => void} unsubscribe */
    subscribe: function (fn) {
      subscribers.push(fn);
      return function () {
        var i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },

    /** Turn recording on/off (effects still run when off — e.g. during replay). */
    record: function (on) {
      recording = !!on;
      return this;
    },
    isRecording: function () {
      return recording;
    },

    /** @returns {object[]} a shallow copy of the recorded log */
    log: function () {
      return log.slice();
    },

    clear: function () {
      log = [];
      seq = 0;
      return this;
    },

    /** @returns {object[]} the log as a JSON-serialisable array (deep-cloned) */
    toJSON: function () {
      return JSON.parse(JSON.stringify(log));
    },

    /** Load a (possibly hand-edited) log. Does NOT run it. */
    fromJSON: function (arr) {
      log = Array.isArray(arr) ? arr.slice() : [];
      seq = log.reduce(function (m, e) {
        return Math.max(m, ((e && e.seq) | 0) + 1);
      }, 0);
      return this;
    },

    /**
     * Register how a given action type is re-performed during replay. App code
     * registers layout handlers (panel.add opens a panel, etc.); any type
     * without a handler falls back to re-applying its captured `changes` — which,
     * thanks to `_watchModel`, also re-renders bound widgets. So model edits
     * replay with no handler at all.
     * @param {string} type
     * @param {(entry: object) => (void|Promise)} fn
     */
    onReplay: function (type, fn) {
      replayHandlers[type] = fn;
      return this;
    },

    /**
     * Re-perform a recorded log, in order. Recording is suppressed throughout,
     * so replay neither re-logs nor feeds undo. Async (panel handlers load
     * widgets); resolves when done.
     *
     * Note: replay assumes a clean starting state (clear the workspace/userData
     * first) so freshly-minted panel ids line up with the recorded ones. It does
     * not reconstruct actions that emit no per-item events (e.g. Clear workspace)
     * or `panel.ref` changes.
     *
     * @param {object[]} [logToPlay] defaults to the current log
     * @param {{ speed?: number, onStep?: (entry, i) => void }} [opts]
     *   speed > 0 replays with the recorded time gaps divided by `speed`
     *   (1 = real time); 0/omitted = as fast as possible.
     * @returns {Promise<void>}
     */
    replay: function (logToPlay, opts) {
      opts = opts || {};
      var entries = (logToPlay || log).slice();
      var speed = opts.speed || 0;
      var onStep = opts.onStep;
      var wasRecording = recording;
      recording = false;

      /**
       * Wait between steps — but only when there is something to wait for.
       *
       * An unpaced replay used to go through `setTimeout(…, 0)` all the same,
       * one timer per entry, which cost it dearly in two ways. A background tab
       * clamps timers to roughly one a second, so a 54-action session took the
       * best part of a minute and looked hung; and even in the foreground, a
       * timer per entry makes "replay at once" needlessly slow for the use that
       * wants it most — rebuilding a model as a test fixture.
       *
       * With no pacing asked for, stay in microtasks: the replay then runs to
       * completion in one go, immune to throttling. The cost is that the page
       * does not repaint mid-replay, which is exactly right for "at once" and
       * irrelevant to the timed path, which still uses real timers.
       */
      function delay(ms) {
        if (!(ms > 0)) return Promise.resolve();
        return new Promise(function (res) {
          setTimeout(res, ms);
        });
      }

      function step(i, prevTs) {
        if (i >= entries.length) {
          recording = wasRecording;
          return Promise.resolve();
        }
        var entry = entries[i];
        var wait =
          speed > 0 && prevTs != null ? (entry.ts - prevTs) / speed : 0;
        return delay(wait)
          .then(function () {
            var handler = replayHandlers[entry.type];
            if (handler) return handler(entry);
            if (entry.changes && entry.changes.length) applyChanges(entry);
          })
          .then(function () {
            if (typeof onStep === 'function') onStep(entry, i);
            return step(i + 1, entry.ts);
          });
      }

      return step(0, null).catch(function (e) {
        recording = wasRecording;
        throw e;
      });
    },
  };
})(window.Sienna);
