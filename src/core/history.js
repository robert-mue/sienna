/**
 * `Sienna.history` — unlimited undo/redo, riding the action stream.
 *
 * It subscribes to `Sienna.actions`: every dispatched entry that carries
 * userData `changes` becomes ONE undoable transaction (so a single user action
 * that touched several paths undoes as one step). Actions with no data effect
 * (panel move/resize/min/maximise, an empty menu selection) are ignored — the
 * scope is **userData only**, so layout is never undone. A fresh action clears
 * the redo stack, as usual.
 *
 * Undo/redo re-apply the captured before/after values straight to userData
 * (removing when the value was absent), WITHOUT dispatching new actions — so
 * they don't pollute the log — but they DO emit userData change events, so any
 * `_watchModel`-ing widget re-renders and the undo is visible. One localStorage
 * write per undo/redo (batched).
 *
 * `scope` is fixed to 'userData' today; it's the seam for later allowing layout
 * actions to be undone too.
 *
 * Classic script. Load after `actions.js` (and `user-data.js`).
 */
(function (Sienna) {
  'use strict';

  var undoStack = [];
  var redoStack = [];

  // Apply one change's target value: absent (undefined) => remove, else set.
  function applyValue(ref, value) {
    if (value === undefined) {
      Sienna.userData.remove(ref);
    } else {
      Sienna.userData.set(ref, value);
    }
  }

  // Reverse a transaction: walk changes back-to-front to their prior values.
  function revert(entry) {
    Sienna.userData.batch(function () {
      for (var i = entry.changes.length - 1; i >= 0; i--) {
        applyValue(entry.changes[i].ref, entry.changes[i].prior);
      }
    });
  }

  // Re-apply a transaction: front-to-back to their new values.
  function reapply(entry) {
    Sienna.userData.batch(function () {
      for (var i = 0; i < entry.changes.length; i++) {
        applyValue(entry.changes[i].ref, entry.changes[i].value);
      }
    });
  }

  Sienna.history = {
    /** Fixed to 'userData' for now (the seam for undoing layout too, later). */
    scope: 'userData',

    undo: function () {
      if (!undoStack.length) return false;
      var entry = undoStack.pop();
      revert(entry);
      redoStack.push(entry);
      return true;
    },

    redo: function () {
      if (!redoStack.length) return false;
      var entry = redoStack.pop();
      reapply(entry);
      undoStack.push(entry);
      return true;
    },

    canUndo: function () {
      return undoStack.length > 0;
    },
    canRedo: function () {
      return redoStack.length > 0;
    },

    /** @returns {number} number of undoable transactions on the stack */
    depth: function () {
      return undoStack.length;
    },

    clear: function () {
      undoStack = [];
      redoStack = [];
      return this;
    },
  };

  // Record every data-changing action as one transaction; a new one drops redo.
  Sienna.actions.subscribe(function (entry) {
    if (entry && entry.changes && entry.changes.length) {
      undoStack.push(entry);
      redoStack = [];
    }
  });
})(window.Sienna);
