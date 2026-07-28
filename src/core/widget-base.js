/**
 * `$.sienna.widgetBase` — an optional base for content widgets that bind to a
 * model. Extend it instead of the bare widget factory:
 *
 *     $.widget('sienna.counter', $.sienna.widgetBase, { ...widget... });
 *
 * It gives a widget three things, so the whole authoring contract is one
 * sentence — *put shared data in the model via `_set`, and wrap user actions in
 * `_action`*:
 *
 *   - Model access scoped to the host panel's `ref` (the path this panel is a
 *     view of): `_ref()` / `_bound()` / `_model()` / `_get(sub)` / `_set(sub,v)`.
 *     When the panel has no `ref` the widget is "unbound" and these no-op — the
 *     widget should fall back to local/option state.
 *   - `_action(name, payload, run)` — dispatch a logged action `'<widget>.<name>'`
 *     targeting the host panel; `run`'s userData changes are captured by the
 *     transaction (undo/replay), all for free.
 *
 * To live-update when the *model* changes underneath it — so sibling panels
 * sharing a `ref` stay in sync, and so undo/import show visibly — a widget opts
 * in with one line in `_create`: `this._watchModel(this._refresh)` (see the
 * counter pilot). Widgets that don't call it simply don't live-update.
 *
 * Classic script. Load after `actions.js`, before any widget is injected.
 */
(function ($, Sienna) {
  'use strict';

  $.widget('sienna.widgetBase', {
    /** The host panel element (the `.slx-panel` ancestor of the content div). */
    _panel: function () {
      if (!this._panelEl || !this._panelEl.length) {
        this._panelEl = this.element.closest('.slx-panel');
      }
      return this._panelEl;
    },

    /** @returns {?string} the host panel's id, or null if not in a panel */
    _panelId: function () {
      var $p = this._panel();
      return $p.length ? $p.panel('id') : null;
    },

    /** @returns {string} the model path this widget views ('' when unbound) */
    _ref: function () {
      var $p = this._panel();
      return $p.length ? $p.panel('ref') || '' : '';
    },

    /** @returns {boolean} whether the widget is bound to a model */
    _bound: function () {
      return !!this._ref();
    },

    /** @returns the whole model object (undefined when unbound) */
    _model: function () {
      return this._bound() ? Sienna.userData.get(this._ref()) : undefined;
    },

    /** Read a property under the model ('sub'), or the whole model (no arg). */
    _get: function (sub) {
      var r = this._ref();
      if (!r) return undefined;
      return Sienna.userData.get(sub ? r + '/' + sub : r);
    },

    /** Write a property under the model; no-op (returns undefined) when unbound. */
    _set: function (sub, value) {
      var r = this._ref();
      if (!r) return undefined;
      return Sienna.userData.set(sub ? r + '/' + sub : r, value);
    },

    /**
     * Live-update: call `handler` (bound to this widget) whenever this widget's
     * model changes — i.e. any userData change at or under its `ref`. This is
     * the pub/sub that keeps sibling panels sharing a `ref` in sync and makes
     * undo/import visible. No-op when unbound.
     *
     * The subscription auto-detaches once the widget's element leaves the
     * document (panel closed), so widgets need no explicit teardown.
     * @returns {() => void} an unsubscribe you may also call manually
     */
    _watchModel: function (handler) {
      var self = this;
      var ref = this._ref();
      if (!ref || !Sienna.userData) {
        return function () {};
      }
      var unsub = Sienna.userData.subscribe(ref, function (change) {
        if (!self.element || !self.element[0] || !self.element[0].isConnected) {
          unsub(); // widget's node was removed — stop listening
          return;
        }
        handler.call(self, change);
      });
      return unsub;
    },

    /**
     * Dispatch a logged user action named '<widgetName>.<name>' targeting the
     * host panel. `run` performs the effect; its userData changes are captured.
     */
    _action: function (name, payload, run) {
      var type = this.widgetName + '.' + name;
      if (Sienna.actions) {
        return Sienna.actions.dispatch(
          { type: type, target: this._panelId(), payload: payload || {} },
          run,
        );
      }
      if (typeof run === 'function') run();
      return null;
    },
  });
})(window.jQuery, window.Sienna);
