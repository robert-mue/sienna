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
        // Raising a panel that views a document makes that document current.
        // This is the shell joining its own two halves: the workspace reports
        // a raise, `documents` decides it means something.
        onRaise: function (ref) {
          if (hasDocuments() && ref) Sienna.documents.setCurrent(ref);
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
        // Which documents there are and what they are called — plus the order
        // of the recently-opened list, since File ▸ Recent is part of the menu
        // and re-orders on every open.
        return Sienna.documents.list().map(function (d) { return d.id + ':' + d.name; }).join('|')
          + '#' + Sienna.documents.recent().map(function (d) { return d.id; }).join(',')
          + '@' + (Sienna.documents.current(self) || '');
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

  /**
   * Open a panel hosting a dynamically loaded widget — in the container that
   * accepts its role, if there is one (DESIGN.md §19), else at the top level.
   * A config naming an `id` already says where it goes (replay), and a
   * `role` in the config overrides the widget's own.
   */
  App.prototype.addPanel = function (config) {
    config = config || {};
    var self = this;
    var top = this.$workspace;
    var target = Promise.resolve(top);
    if (!config.id) {
      var spec = config.widget && Sienna.widgetRegistry.spec(config.widget);
      var role = config.role || (spec && spec.role);
      var ref = config.ref || '';
      var $ws = top.workspace('workspaceFor', role, ref);
      var plan = !$ws && ref ? top.workspace('templateFor', role, ref) : null;
      if ($ws) {
        target = Promise.resolve($ws);
      } else if (plan) {
        // This document has no collection here yet: make one from the template,
        // then look again — it now holds a place for the panel (§19.1). Unless
        // the collection came WITH the panel asked for, as a Simulation comes
        // with its run control: then that one is the answer, not a second.
        target = plan.$ws.workspace('addPanel', this._fromTemplate(plan.template, ref))
          .then(function ($made) {
            var given = config.widget && self._panelsIn($made).find(function ($p) {
              return self.widgetOf($p) === config.widget;
            });
            return given ? { given: given } : top.workspace('workspaceFor', role, ref) || top;
          });
      }
    }
    return target.then(function (t) {
      return t.given || t.workspace('addPanel', config);
    }).then(function ($panel) {
      // Opened into a container in a tab not showing, it would be invisible.
      top.workspace('reveal', $panel);
      return $panel;
    });
  };

  /**
   * A template, made into one document's collection: its `ref` stamped
   * throughout (so it belongs to the document, and wears its colour), marked
   * to close itself once emptied, and titled after the document.
   */
  App.prototype._fromTemplate = function (template, ref) {
    var copy = JSON.parse(JSON.stringify(template));
    (function stamp(c) {
      c.ref = ref;
      ((c.options && c.options.children) || []).forEach(stamp);
    })(copy);
    copy.options = copy.options || {};
    copy.options.fromTemplate = true;
    copy.title = this._docName(ref) + ': ' + (template.title || 'Collection');
    return copy;
  };

  /** A document's name, for titles: its own `name` if it has one, else its id. */
  App.prototype._docName = function (ref) {
    var doc = Sienna.userData && Sienna.userData.get(ref);
    if (doc && doc.name) return doc.name;
    return String(ref).split('/').pop();
  };

  /** Save the workspace now. Needed after changing panels outside the widgets. */
  App.prototype.persist = function () {
    this._persist();
    return this;
  };

  /**
   * @returns {JQuery[]} every open panel at any depth — containers and what is
   *   inside them, depth first in workspace order. An app needs these to name a
   *   new panel after its neighbours, wherever they sit.
   */
  App.prototype.panels = function () {
    return walkPanels(this.$workspace);
  };

  /** Every panel inside a container panel, at any depth. */
  App.prototype._panelsIn = function ($panel) {
    var $nested = $panel.panel('content').children('.slx-workspace');
    return $nested.length ? walkPanels($nested) : [];
  };

  function walkPanels($ws) {
    var out = [];
    $ws.workspace('panels').forEach(function ($p) {
      out.push($p);
      var $nested = $p.panel('content').children('.slx-workspace');
      if ($nested.length) out = out.concat(walkPanels($nested));
    });
    return out;
  }

  /** @returns {?string} the widget name a panel is hosting, or null — at any depth. */
  App.prototype.widgetOf = function ($panel) {
    var $ws = $panel.parent();
    return $ws.workspace('instance') ? $ws.workspace('widgetOf', $panel) : null;
  };

  /** Remove every open panel (also clears the persisted state). */
  App.prototype.clearWorkspace = function () {
    this.$workspace.workspace('clear');
    return this;
  };

  /**
   * Restore the workspace from localStorage, if anything was saved; if not,
   * lay it out with the app's default layout, if it has one.
   * @returns {Promise<boolean>} whether a saved session was restored
   */
  App.prototype.restore = function () {
    var state = Sienna.persistence.load();
    // Older sessions saved the bare panel array; newer ones the top level's
    // arrangement beside it.
    var panels = Array.isArray(state) ? state : (state && state.panels) || [];
    var arrangement = state && !Array.isArray(state) ? state.arrangement : null;
    if (panels.length || arrangement) {
      if (arrangement) this._arrange(arrangement);
      return this.$workspace.workspace('restore', panels).then(function () {
        return true;
      });
    }
    var dflt = Sienna.layouts && Sienna.layouts.defaultName();
    if (dflt) {
      return this.applyLayout(dflt, { keepPanels: false }).then(function () {
        return false;
      });
    }
    return Promise.resolve(false);
  };

  /** Set the top level's own arrangement — mode, direction, accepts, templates. */
  App.prototype._arrange = function (a) {
    this.$workspace.workspace('option', {
      mode: a.mode || 'floating',
      direction: a.direction || 'row',
      active: a.active || null,
      accepts: a.accepts || [],
      templates: a.templates || [],
    });
  };

  /**
   * Lay the workspace out afresh with one of the app's layouts (DESIGN.md
   * §20). The panels that were open are opened again into it — the ones that
   * show something, not the containers that held them — so each lands where
   * its role and document now say. One logged action, `layout.apply`; replay
   * re-applies it with `keepPanels: false`, since the panels opened again
   * afterwards were logged in their own right.
   * @param {string} name
   * @param {{ keepPanels?: boolean }} [opts]
   * @returns {Promise<void>}
   */
  App.prototype.applyLayout = function (name, opts) {
    var layout = Sienna.layouts && Sienna.layouts.get(name);
    if (!layout) return Promise.reject(new Error('Unknown layout: "' + name + '"'));
    var keep = opts && opts.keepPanels === false ? [] : this._leafConfigs();
    var self = this;
    if (Sienna.actions) {
      Sienna.actions.dispatch({ type: 'layout.apply', target: null, payload: { name: name } });
    }
    this.$workspace.workspace('clear');
    this._arrange(layout);
    return this.$workspace.workspace('restore', layout.panels || []).then(function () {
      return keep.reduce(function (p, config) {
        return p.then(function () { return self.addPanel(config); });
      }, Promise.resolve());
    }).then(function () {
      self._persist();
    });
  };

  /** Every open panel that is not a container, as a config to open it again. */
  App.prototype._leafConfigs = function () {
    var out = [];
    (function walk(list) {
      list.forEach(function (item) {
        if (item.widget === 'container') {
          walk((item.options && item.options.children) || []);
        } else {
          out.push({ widget: item.widget, title: item.title, ref: item.ref, options: item.options });
        }
      });
    })(this.$workspace.workspace('serialize'));
    return out;
  };

  App.prototype._persist = function () {
    Sienna.persistence.save({
      arrangement: this.$workspace.workspace('arrangement'),
      panels: this.$workspace.workspace('serialize'),
    });
  };

  Sienna.App = App;
})(window.Sienna, window.jQuery);
