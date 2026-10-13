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

    // A new-user preview says so in the tab title, or two tabs of one app are
    // easy to confuse. Not in the page: whoever opened it knows they did.
    if (Sienna.newUser) document.title = 'New user — ' + document.title;

    var self = this;
    this.$workspace = $('<div class="slx-app-workspace">')
      .appendTo(this.$root)
      .workspace({
        onChange: function () {
          self._persist();
          self._refreshWindows();
        },
        // Raising a panel that views a document makes that document current.
        // This is the shell joining its own two halves: the workspace reports
        // a raise, `documents` decides it means something.
        onRaise: function (ref) {
          if (hasDocuments() && ref) Sienna.documents.setCurrent(ref);
        },
      })
      // From any depth, since workspaces say it on their own elements.
      .on('slxpanelclose', function (e, $panel) {
        self._closeCompanions($panel);
      });
  }

  // A document's primary collection closing (its Model window, whether by its
  // own close button or because its last panel went) closes the document's
  // other collections: a model closed is closed. After the close in hand.
  App.prototype._closeCompanions = function ($closed) {
    var $c = $closed.panel('content');
    if (!$c.hasClass('slx-container') || !$c.container('option', 'primary')) return;
    var ref = $closed.panel('ref');
    var self = this;
    Promise.resolve().then(function () {
      self.panels().forEach(function ($p) {
        if (!$p[0].isConnected || $p[0] === $closed[0] || $p.panel('ref') !== ref) return;
        var $pc = $p.panel('content');
        if ($pc.hasClass('slx-container') && $pc.container('option', 'fromTemplate')) $p.panel('close');
      });
    });
  };

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
    this._showCurrent();

    // A document renamed (or a rename undone): the panels titled after it
    // follow. Heard here rather than done by `documents.rename`, so that undo
    // and replay, which only put the name back, put the titles back too.
    if (hasDocuments() && !this._nameWatch) {
      var app = this;
      var root = Sienna.documents.root();
      this._nameWatch = Sienna.userData.subscribe(root, function (e) {
        var m = new RegExp('^' + root + '/([^/]+)/name$').exec(e.ref || '');
        if (!m) return;
        app._retitle(root + '/' + m[1], e.prior || m[1], e.value || m[1]);
      });
    }

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
        self._showCurrent();
      });
    }
    return this;
  };

  /**
   * A short note at the right-hand end of the menu bar — which release this
   * is, say. The app's to word; the shell only gives it a place. Empty text
   * removes it.
   */
  App.prototype.setNote = function (text, tooltip) {
    if (!this._$note) this._$note = $('<div class="slx-app-note">').appendTo(this.$menu);
    this._$note.text(text || '').attr('title', tooltip || null).toggle(!!text);
    return this;
  };

  /**
   * The current document, said in the menu bar after the menus — "Current
   * model: Growth", with the model's colour — so which one the commands act on
   * is in plain sight rather than something to go and find. Kept up to date
   * by the same watch that keeps File's lists current.
   */
  App.prototype._showCurrent = function () {
    if (!hasDocuments()) return;
    if (!this._$current) {
      this._$current = $('<div class="slx-current-doc">').insertAfter(this.$menu.children('.slx-menu-list'));
    }
    var label = Sienna.documents.label() || 'document';
    var Label = label.charAt(0).toUpperCase() + label.slice(1);
    var cur = Sienna.documents.current(this);
    this._$current.empty();
    if (!cur) {
      this._$current.append($('<span class="slx-current-none">').text('No current ' + label));
      return;
    }
    $('<span class="slx-current-swatch">').css('background', Sienna.subjectColour(cur)).appendTo(this._$current);
    $('<span class="slx-current-label">').text('Current ' + label + ':').appendTo(this._$current);
    $('<span class="slx-current-name">').text(this._docName(cur)).appendTo(this._$current);
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
        // Templates marked `openWithDocument` are made alongside, so opening a
        // model opens its Simulation window too.
        target = this._makeCollection(plan.$ws, plan.template, ref)
          .then(function ($made) {
            var others = (plan.$ws.workspace('option', 'templates') || []).filter(function (t) {
              return t.openWithDocument && t.title !== plan.template.title
                && !self._collectionOf(plan.$ws, t, ref);
            });
            return others.reduce(function (p, t) {
              return p.then(function () { return self._makeCollection(plan.$ws, t, ref); });
            }, Promise.resolve()).then(function () { return $made; });
          })
          .then(function ($made) {
            var given = config.widget && self._panelsIn($made).find(function ($p) {
              return self.widgetOf($p) === config.widget;
            });
            return given ? { given: given } : top.workspace('workspaceFor', role, ref) || top;
          });
      }
    }
    return target.then(function (t) {
      // The panel the template supplied takes the title asked for.
      if (t.given && config.title) t.given.panel('title', config.title);
      return t.given || t.workspace('addPanel', config);
    }).then(function ($panel) {
      // Opened into a container in a tab not showing, it would be invisible.
      top.workspace('reveal', $panel);
      return $panel;
    });
  };

  /** Make one document's collection from a template, in workspace `$ws`. */
  App.prototype._makeCollection = function ($ws, template, ref) {
    return $ws.workspace('addPanel', this._fromTemplate(template, ref, $ws));
  };

  /** The collection in `$ws` already made from this template for `ref`, if any. */
  App.prototype._collectionOf = function ($ws, template, ref) {
    var mark = template.title || true;
    return $ws.workspace('panels').find(function ($p) {
      var $c = $p.panel('content');
      return $p.panel('ref') === ref && $c.hasClass('slx-container')
        && $c.container('option', 'fromTemplate') === mark;
    }) || null;
  };

  /**
   * A template, made into one document's collection: its `ref` stamped
   * throughout (so it belongs to the document, and wears its colour), marked
   * with the template it came from (so it closes itself once emptied, and is
   * not made twice), and titled after the document.
   *
   * Its `geometry` may give fractions of the workspace (any number in (0, 1]),
   * worked out now, so a window is the same share of a laptop's screen as of a
   * big monitor's — a size in pixels is how a diagram came to be taller than
   * a small workspace. Each further collection from the same template is
   * offset a step down and right, so the second model's windows do not land
   * exactly on the first's.
   */
  App.prototype._fromTemplate = function (template, ref, $ws) {
    var copy = JSON.parse(JSON.stringify(template));
    (function stamp(c) {
      c.ref = ref;
      ((c.options && c.options.children) || []).forEach(stamp);
    })(copy);
    copy.options = copy.options || {};
    copy.options.fromTemplate = template.title || true;
    copy.title = this._docName(ref) + ': ' + (template.title || 'Collection');
    copy.options.primary = !!template.primary;
    if (copy.geometry && $ws) {
      var W = $ws.innerWidth();
      var H = $ws.innerHeight();
      var frac = function (v, total) {
        return typeof v === 'number' && v > 0 && v <= 1 ? Math.round(v * total) : v;
      };
      var g = copy.geometry;
      var mark = copy.options.fromTemplate;
      var step = 28 * $ws.workspace('panels').filter(function ($p) {
        var $c = $p.panel('content');
        return $c.hasClass('slx-container') && $c.container('option', 'fromTemplate') === mark;
      }).length;
      var width = frac(g.width, W);
      var height = frac(g.height, H);
      copy.geometry = { width: width, height: height };
      if (g.left != null) copy.geometry.left = Math.max(0, Math.min(frac(g.left, W) + step, W - (width || 0)));
      if (g.top != null) copy.geometry.top = Math.max(0, Math.min(frac(g.top, H) + step, H - (height || 0)));
    }
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

  /**
   * @returns {JQuery[]} the WINDOWS — the panels at the top level of the
   *   workspace, which is what a user means by a window (a model window, a
   *   simulation window); what is inside one is a panel.
   */
  App.prototype.windows = function () {
    return this.$workspace.workspace('panels');
  };

  /** Bring a window, or any panel, into view and to the front. */
  App.prototype.showWindow = function ($panel) {
    if ($panel.panel('minimized')) $panel.panel('minimize', false);
    this.$workspace.workspace('reveal', $panel);
    return this;
  };

  /**
   * Menu items, one per open window, each bringing it to the front — for a
   * View ▸ Windows submenu. Pass the method itself as the submenu's `items`
   * (`function () { return app.windowItems(); }`) and it stays current: the
   * menu is re-drawn whenever the set of windows changes.
   */
  App.prototype.windowItems = function () {
    var self = this;
    var list = this.windows();
    if (!list.length) return [{ label: '(no windows open)' }];
    return list.map(function ($p) {
      return { label: $p.panel('title'), onSelect: function () { self.showWindow($p); } };
    });
  };

  /**
   * Lay these windows side by side across the workspace, each the full height,
   * in the order given, and bring them to the front. For comparing two models,
   * or two runs, or a model with its own run. Only in a floating top level —
   * a tiled one already decides where its windows go.
   */
  App.prototype.sideBySide = function (list) {
    var $ws = this.$workspace;
    if ($ws.workspace('option', 'mode') !== 'floating' || !list.length) return this;
    var W = $ws.innerWidth();
    var H = $ws.innerHeight();
    var w = Math.floor(W / list.length);
    var self = this;
    list.forEach(function ($p, i) {
      if ($p.panel('maximized')) $p.panel('maximize', false);
      if ($p.panel('minimized')) $p.panel('minimize', false);
      $p.panel('setGeometry', { left: i * w, top: 0, width: w, height: H });
      self.showWindow($p);
    });
    this._persist();
    return this;
  };

  /** Re-draw the menu when the set of windows (or their titles) changes. */
  App.prototype._refreshWindows = function () {
    var sig = this.windows().map(function ($p) {
      return $p.panel('id') + ':' + $p.panel('title');
    }).join('|');
    if (sig === this._windowsSig) return;
    this._windowsSig = sig;
    if (this._appMenu) this.$menu.menu('items', this._menuItems());
  };

  /**
   * Every panel viewing `docPath` whose title begins with the document's old
   * name — "Growth: Model", "Growth: diagram/1" — takes the new one; the rest
   * of each title, a panel's number included, is left alone.
   */
  App.prototype._retitle = function (docPath, was, now) {
    if (was === now) return;
    var from = was + ': ';
    var touched = [];
    this.panels().forEach(function ($p) {
      var t = $p.panel('title') || '';
      if ($p.panel('ref') !== docPath || t.indexOf(from) !== 0) return;
      $p.panel('title', now + ': ' + t.slice(from.length));
      var $ws = $p.parent();
      if (touched.indexOf($ws[0]) < 0) touched.push($ws[0]);
    });
    if (!touched.length) return;
    // A tab copies its panel's title when it is drawn, so draw them again.
    touched.forEach(function (ws) {
      var $ws = $(ws);
      if ($ws.workspace('instance')) $ws.workspace('arrange');
    });
    this._persist();
    this._refreshWindows();
  };

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
