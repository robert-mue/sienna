/**
 * The demo's layouts (DESIGN.md §20) — the arrangements it ships with.
 *
 * "Model and simulation" is Simile's default in miniature: one area of
 * per-model collections for models, one for simulations (§19.1). Opening a
 * model (File ▸ New) gives it a Model collection; a note opened for it — the
 * demo's stand-in for a plot — gives it a Simulation collection with the note
 * in its Displays; a tool goes in beside them.
 *
 * Classic script; no imports/exports.
 */
(function (Sienna) {
  'use strict';

  Sienna.layouts.register('free', {
    label: 'Free (floating)',
    default: true,
    mode: 'floating',
    panels: [],
  });

  Sienna.layouts.register('model-simulation', {
    label: 'Model and simulation',
    mode: 'tiled',
    direction: 'row',
    panels: [
      {
        widget: 'container',
        title: 'Models',
        options: {
          mode: 'tabbed',
          templates: [
            { widget: 'container', title: 'Model', options: { accepts: ['model'] } },
          ],
        },
      },
      {
        widget: 'container',
        title: 'Simulations',
        options: {
          mode: 'tabbed',
          templates: [
            {
              widget: 'container',
              title: 'Simulation',
              options: {
                mode: 'tiled',
                direction: 'column',
                accepts: ['tool'],
                children: [
                  { widget: 'container', title: 'Displays', options: { mode: 'tabbed', accepts: ['note'] } },
                ],
              },
            },
          ],
        },
      },
    ],
  });
})(window.Sienna);
