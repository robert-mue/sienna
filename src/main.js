/**
 * Bootstrap: build the App, define the menu, restore any saved workspace.
 *
 * The menu is rebuilt from data:
 *   - the Widgets submenu comes from the widget registry (src/widgets/index.js),
 *   - the File ▸ Open submenu comes from the model list (Sienna.models),
 * so this file holds no per-widget or per-model knowledge. The menu is rebuilt
 * whenever the set of models changes (a userData change under `models`).
 *
 * Classic script — runs after all core scripts have loaded. No imports/exports.
 */
(function (Sienna) {
  'use strict';

  var app = new Sienna.App('#app');
  var models = Sienna.models;

  // One Widgets entry per registered widget, in registration order.
  var widgetItems = Sienna.widgetRegistry.list().map(function (w) {
    return {
      label: w.label,
      onSelect: function () {
        app.addPanel({ title: w.title, widget: w.name, options: w.options });
      },
    };
  });

  // Open a panel viewing a model (the counter is the model-bound pilot widget).
  function openModel(ref) {
    var m = models.get(ref) || {};
    app.addPanel({ title: m.name || ref, widget: 'counter', ref: ref });
  }

  // --- Replay: teach the action layer how to re-perform layout actions.
  // (Model edits need no handler — replay re-applies their captured changes,
  // and _watchModel re-renders the bound widgets.)
  function byId(id) {
    return app.$workspace.workspace('panelById', id);
  }
  Sienna.actions.onReplay('panel.add', function (e) {
    return app.addPanel({
      title: e.payload.title,
      widget: e.payload.widget || undefined,
      ref: e.payload.ref || '',
    });
  });
  Sienna.actions.onReplay('panel.close', function (e) {
    var $p = byId(e.target);
    if ($p) $p.panel('close');
  });
  function replayGeometry(e) {
    var $p = byId(e.target);
    if ($p) $p.panel('setGeometry', e.payload);
  }
  Sienna.actions.onReplay('panel.move', replayGeometry);
  Sienna.actions.onReplay('panel.resize', replayGeometry);
  Sienna.actions.onReplay('panel.minimize', function (e) {
    var $p = byId(e.target);
    if ($p) $p.panel('minimize', !!e.payload.minimized);
  });
  Sienna.actions.onReplay('panel.maximize', function (e) {
    var $p = byId(e.target);
    if ($p) $p.panel('maximize', !!e.payload.maximized);
  });

  // Replay the recorded session onto a clean slate (destroys current state).
  function replaySession() {
    var session = Sienna.actions.log();
    app.clearWorkspace();
    Sienna.userData.clear();
    Sienna.history.clear();
    Sienna.actions.replay(session);
  }

  // File ▸ Open lists the current models; empty => a single inert placeholder.
  function openItems() {
    var list = models.list();
    if (!list.length) return [{ label: '(no models)' }];
    return list.map(function (m) {
      return {
        label: m.name,
        onSelect: function () {
          models.setCurrent(m.ref);
          openModel(m.ref);
        },
      };
    });
  }

  function fileItems() {
    return [
      {
        label: 'New',
        onSelect: function () {
          openModel(models.create());
        },
      },
      { label: 'Open', items: openItems() },
      {
        label: 'Save As',
        onSelect: function () {
          var c = models.current();
          if (c) models.copy(c);
        },
      },
      {
        label: 'Export',
        onSelect: function () {
          var c = models.current();
          if (c) models.exportFile(c);
        },
      },
      { label: 'Import', onSelect: function () { models.importFile(); } },
      { label: 'Export all', onSelect: function () { models.exportAll(); } },
      { label: 'Import all', onSelect: function () { models.importAll(); } },
    ];
  }

  function buildMenu() {
    return [
      { label: 'File', items: fileItems() },
      {
        label: 'Edit',
        items: [
          { label: 'Undo', onSelect: function () { Sienna.history.undo(); } },
          { label: 'Redo', onSelect: function () { Sienna.history.redo(); } },
        ],
      },
      { label: 'Widgets', items: widgetItems },
      {
        label: 'Session',
        items: [
          { label: 'Replay', onSelect: replaySession },
          {
            label: 'Export log',
            onSelect: function () {
              Sienna.files.download('sienna-log.json', Sienna.actions.toJSON());
            },
          },
          {
            label: 'Import log',
            onSelect: function () {
              Sienna.files.pickFile(function (arr) {
                Sienna.actions.fromJSON(arr);
              });
            },
          },
        ],
      },
      {
        label: 'View',
        items: [
          {
            label: 'Clear workspace',
            onSelect: function () {
              app.clearWorkspace();
            },
          },
        ],
      },
    ];
  }

  app.setMenu(buildMenu());

  // Rebuild the menu only when the *set* of models (ids/names) changes, so a
  // model's contents changing (e.g. a bound counter's count) doesn't rebuild it.
  function modelsSignature() {
    return JSON.stringify(
      models.list().map(function (m) {
        return [m.id, m.name];
      }),
    );
  }
  var lastSignature = modelsSignature();
  Sienna.userData.subscribe('models', function () {
    var sig = modelsSignature();
    if (sig === lastSignature) return;
    lastSignature = sig;
    app.setMenu(buildMenu());
  });

  // Keyboard: Ctrl/Cmd-Z = undo, Ctrl/Cmd-Shift-Z (or Ctrl-Y) = redo. Skip when
  // typing in a field so native text undo keeps working there.
  $(document).on('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || e.target.isContentEditable) {
      return;
    }
    var key = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (mod && key === 'z' && !e.shiftKey) {
      e.preventDefault();
      Sienna.history.undo();
    } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
      e.preventDefault();
      Sienna.history.redo();
    }
  });

  // Restore any panels saved from a previous session.
  app.restore();

  // Handy for tinkering from the browser console.
  window.app = app;
})(window.Sienna);
