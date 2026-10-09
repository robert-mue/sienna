/**
 * The widget manifest — the ONE place that lists the app's content widgets.
 *
 * Each entry gives the script URL (loaded on demand) plus the presentation
 * metadata the menu needs: `label` (menu text), `title` (panel titlebar), and
 * optional default `options`. `main.js` builds the Widgets menu from this list,
 * so adding a widget is a single registration here (plus its widget script) —
 * no changes to main.js or any generic code.
 *
 * To add a widget: create `src/widgets/<name>.js` that calls
 * `$.widget('sienna.<name>', {...})` and, at the end,
 * `Sienna.widgetRegistry._loaded('<name>', '<name>')`; then add a line here.
 *
 * Classic script; no imports/exports.
 */
(function (Sienna) {
  'use strict';
  var reg = Sienna.widgetRegistry;

  // `role` decides which container a widget opens in (DESIGN.md §19).
  reg.register('clock', {
    src: 'widgets/clock.js',
    label: 'Clock',
    title: 'Clock',
    role: 'tool',
  });
  reg.register('hello', {
    src: 'widgets/hello.js',
    label: 'Greeting',
    title: 'Greeting',
    options: { name: 'sienna' },
    role: 'tool',
  });
  reg.register('counter', {
    src: 'widgets/counter.js',
    label: 'Counter',
    title: 'Counter',
    role: 'model',
  });
  reg.register('notepad', {
    src: 'widgets/notepad.js',
    label: 'Notepad',
    title: 'Notepad',
    role: 'note',
  });
  reg.register('colorpicker', {
    src: 'widgets/colorpicker.js',
    label: 'Colour picker',
    title: 'Colour',
    role: 'tool',
  });
})(window.Sienna);
