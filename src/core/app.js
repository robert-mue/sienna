/**
 * App — composes the SPA out of a customisable menu and a panel workspace,
 * both mounted inside a single root element. Persists the workspace to
 * localStorage on every change and can restore it. Exposed as `Sienna.App`.
 *
 * The **File menu is the shell's own**, not the app's: the shell is a host that
 * becomes a particular application, and the conventional furniture along the
 * top should be the same whichever application that is. So `setMenu` inserts
 * File ahead of whatever the app supplies, built from `Sienna.documents` — and
 * refreshes it whenever the set of documents changes, so newly created or
 * opened ones appear without the app doing anything.
 *
 * An app that never calls `Sienna.documents.configure()` gets no File menu, so
 * this costs nothing to an app with no documents.
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

  /** True once an app has declared what its documents are. */
  function hasDocuments() {
    return !!(Sienna.documents && Sienna.documents.isConfigured());
  }

  /** The app's menus, with the shell's File menu in front. */
  App.prototype._menuItems = function () {
    var items = (this._appMenu || []).slice();
    if (hasDocuments()) {
      items.unshift({ label: 'File', items: Sienna.documents.menuItems(this) });
    }
    return items;
  };

  /**
   * Replace the app's menu items. The shell's File menu is prepended here, so
   * an app never builds or even mentions it.
   */
  App.prototype.setMenu = function (items) {
    this._appMenu = items || [];
    this.$menu.menu('items', this._menuItems());

    // Keep File's document list current. Guarded by a signature so that edits
    // INSIDE a document — which fire constantly — do not rebuild the menu.
    if (hasDocuments() && !this._docWatch) {
      var self = this;
      var sig = function () {
        return Sienna.documents.list().map(function (d) { return d.id + ':' + d.name; }).join('|');
      };
      var last = sig();
      this._docWatch = Sienna.userData.subscribe('', function () {
        var now = sig();
        if (now === last) return;
        last = now;
        self.$menu.menu('items', self._menuItems());
      });
    }
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
