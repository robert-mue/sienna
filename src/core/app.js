/**
 * App — composes the SPA out of a customisable menu and a panel workspace,
 * both mounted inside a single root element. Persists the workspace to
 * localStorage on every change and can restore it. Exposed as `Sienna.App`.
 *
 * Classic script: uses the global jQuery (`$`), `Sienna.persistence`, and the
 * `menu`/`workspace` widgets (load their scripts first). No imports/exports.
 */
(function (Sienna, $) {
  'use strict';

  function App(root, options) {
    options = options || {};
    var items = options.items || [];

    this.$root = $(root).addClass('slx-app');
    this.$menu = $('<div class="slx-app-menu">')
      .appendTo(this.$root)
      .menu({ items: items });

    var self = this;
    this.$workspace = $('<div class="slx-app-workspace">')
      .appendTo(this.$root)
      .workspace({
        onChange: function () {
          self._persist();
        },
      });
  }

  /** Replace the menu items. */
  App.prototype.setMenu = function (items) {
    this.$menu.menu('items', items);
    return this;
  };

  /** Open a panel hosting a dynamically loaded widget. */
  App.prototype.addPanel = function (config) {
    return this.$workspace.workspace('addPanel', config);
  };

  /** Remove every open panel (also clears the persisted state). */
  App.prototype.clearWorkspace = function () {
    this.$workspace.workspace('clear');
    return this;
  };

  /**
   * Restore the workspace from localStorage, if anything was saved.
   * @returns {Promise<boolean>} whether panels were restored
   */
  App.prototype.restore = function () {
    var state = Sienna.persistence.load();
    if (state && state.length) {
      return this.$workspace.workspace('restore', state).then(function () {
        return true;
      });
    }
    return Promise.resolve(false);
  };

  App.prototype._persist = function () {
    Sienna.persistence.save(this.$workspace.workspace('serialize'));
  };

  Sienna.App = App;
})(window.Sienna, window.jQuery);
