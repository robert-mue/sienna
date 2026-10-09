/**
 * `Sienna.layouts` — the arrangements an app ships with (DESIGN.md §20).
 *
 * A layout says how the workspace starts: the top level's own arrangement
 * (`mode`, `direction`, `accepts`, `templates`) plus the panels it opens with,
 * in `workspace.serialize()` shape — typically empty containers, which the
 * user's panels then reach by role. So a layout is data, the same shape as a
 * saved session, and a user-made layout later is a saved session with its
 * refs taken out.
 *
 *   Sienna.layouts.register('simile', {
 *     label: 'Model and simulation',
 *     default: true,
 *     mode: 'tiled',
 *     panels: [{ widget: 'container', title: 'Models', options: { … } }, …],
 *   });
 *
 * The one marked `default` is what `App.restore` applies when nothing was
 * saved; `App.applyLayout(name)` applies one on demand, and
 * `menuItems(app)` lists them for a menu.
 *
 * Classic script; no imports/exports. Load before app.js.
 */
(function (Sienna) {
  'use strict';

  var registry = {};
  var order = [];

  Sienna.layouts = {
    /**
     * @param {string} name
     * @param {{ label?: string, default?: boolean, mode?: string,
     *           direction?: string, accepts?: string[], templates?: object[],
     *           panels?: object[] }} layout
     */
    register: function (name, layout) {
      if (!registry[name]) order.push(name);
      registry[name] = JSON.parse(JSON.stringify(layout || {}));
      registry[name].name = name;
      registry[name].label = registry[name].label || name;
    },

    /** @returns {Array<{name:string, label:string}>} in registration order */
    list: function () {
      return order.map(function (name) {
        return { name: name, label: registry[name].label };
      });
    },

    /** @returns {?object} a copy of one layout, or null */
    get: function (name) {
      return registry[name] ? JSON.parse(JSON.stringify(registry[name])) : null;
    },

    /** @returns {?string} the default layout's name: the one marked, else none */
    defaultName: function () {
      for (var i = 0; i < order.length; i++) {
        if (registry[order[i]].default) return order[i];
      }
      return null;
    },

    /** Menu items applying each layout — for an app to put where it likes. */
    menuItems: function (app) {
      return Sienna.layouts.list().map(function (l) {
        return {
          label: l.label,
          onSelect: function () { app.applyLayout(l.name); },
        };
      });
    },
  };
})(window.Sienna);
