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

  reg.register('clock', {
    src: 'src/widgets/clock.js',
    label: 'Clock',
    title: 'Clock',
  });
  reg.register('hello', {
    src: 'src/widgets/hello.js',
    label: 'Greeting',
    title: 'Greeting',
    options: { name: 'sienna' },
  });
  reg.register('counter', {
    src: 'src/widgets/counter.js',
    label: 'Counter',
    title: 'Counter',
  });
  reg.register('notepad', {
    src: 'src/widgets/notepad.js',
    label: 'Notepad',
    title: 'Notepad',
  });
  reg.register('colorpicker', {
    src: 'src/widgets/colorpicker.js',
    label: 'Colour picker',
    title: 'Colour',
  });
})(window.Sienna);
