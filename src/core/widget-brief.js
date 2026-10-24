/**
 * The brief for an AI assistant — `Sienna.widgetBrief`.
 *
 * Many people who want a widget the app lacks will ask an AI assistant to
 * write it. This is the whole of what the assistant needs to know, in one
 * text to paste into the chat before describing the widget wanted: what a
 * widget file is, what it may use, what it must not do, and how the user
 * adds the result. Written TO the assistant, in its terms.
 *
 * The shell's part is generic. An app adds what only it knows — chiefly how
 * a widget gets at the app's own data — with `addSection(title, text)`, and
 * names itself with `setApp(name)`. `text()` is the whole brief.
 *
 * Kept as a script rather than a Markdown file because the app runs from
 * file://, where a page cannot read a file it was not given.
 *
 * Classic script. Load after `widget-registry.js`.
 */
(function (Sienna) {
  'use strict';

  var appName = 'a sienna app';
  var sections = [];

  var GENERIC = [
    '# Writing a widget for {APP}',
    '',
    'You are writing a WIDGET: a panel that the user adds to {APP}, a web',
    'application built on "sienna", a jQuery shell of floating windows and',
    'panels. The user will save what you write as ONE JavaScript file and add',
    'it with Widgets > Add a widget... . Answer with that complete file in one',
    'code block, then a few lines on how to use the widget.',
    '',
    '## The file',
    '',
    'The whole file is one call. No `import`, `export`, `require` or modules:',
    'it is loaded as a classic <script> into a page that already has jQuery',
    '(`$`, 3.7), the jQuery UI widget factory and the global `Sienna`.',
    '',
    '```js',
    'Sienna.widget({',
    '  name: \'bigNumber\',          // letters, digits, _ ; starts with a letter; unique',
    '  label: \'Big number\',        // the Widgets menu entry',
    '  title: \'Big number\',        // the panel title (optional)',
    '  notes: \'One value, large.\', // what it does: shown before the user adds it',
    '  author: \'…\', version: \'1.0\',',
    '  contract: 1,                // the widget contract this is written for',
    '  options: { digits: 3 },     // default options (optional)',
    '  role: \'display\',            // which kind of window it opens in (optional; see the app section)',
    '  widget: {                   // the jQuery UI widget prototype',
    '    options: { digits: 3 },',
    '    _create: function () { /* build the DOM inside this.element */ },',
    '    _destroy: function () { /* undo anything outside this.element */ },',
    '  },',
    '});',
    '```',
    '',
    'The shell defines the jQuery UI widget for you from `widget` (as',
    '`$.widget(\'sienna.<name>\', $.sienna.widgetBase, widget)`) and registers it.',
    'Do NOT call `$.widget` or `Sienna.widgetRegistry` yourself. A name the app',
    'already uses (or any jQuery method name: `show`, `data`, `text`, ...) is',
    'refused, so pick a distinctive one.',
    '',
    '## Inside the widget',
    '',
    '- `this.element` is the panel\'s content <div> (a jQuery object). Build',
    '  everything inside it. `this.options` holds the options.',
    '- Toolbars and controls should carry the class `slx-chrome`: when the user',
    '  shrinks the panel to a thumbnail, those are hidden and the rest stays.',
    '- The panel can be resized at any time. To redraw to fit, call',
    '  `this._watchPanelResize(fn)` once in `_create`; `fn` runs after each',
    '  resize. Read the size from `this.element` (width(), height()).',
    '- View state that should survive a reload (a choice the user made, a',
    '  scroll position): return it from a method `state()` as a plain object',
    '  whose keys are option names. It is saved with the panel and passed back',
    '  as options next time. Small values only.',
    '- `_destroy` must undo whatever `_create` did outside `this.element`:',
    '  timers (`clearInterval`), subscriptions, document listeners.',
    '- Styling: inline styles, or one <style> element you add once (check by',
    '  id first), with every class prefixed by your widget\'s name. Never style',
    '  bare elements (`button { … }`) or the shell\'s `slx-` classes: that would',
    '  change the whole app.',
    '',
    '## The user\'s data',
    '',
    'A panel usually belongs to one of the user\'s documents (for example a',
    'model). The widget base gives you, all no-ops when the panel has none:',
    '',
    '- `this._ref()`: the document\'s path (a string), or \'\' if none.',
    '- `this._model()`: the document itself (read only: never modify it in',
    '  place).',
    '- `this._get(\'sub/path\')`, `this._set(\'sub/path\', value)`: read and write',
    '  inside the document. Writes are saved and can be undone.',
    '- `this._action(\'what\', payload, function () { ...this._set(...)... })`:',
    '  wrap a user\'s edit, so it is logged and undone as one step.',
    '- `this._watchModel(fn)`: call once in `_create`; `fn` runs whenever the',
    '  document changes (an edit, an undo), so the widget stays current.',
    '',
    'Only write to the document if the user asked for a widget that edits it.',
    'A display should only read.',
    '',
    '## What not to do',
    '',
    '- No network access unless the user asked for it (no fetch to other',
    '  sites, no analytics, no loading scripts from elsewhere). The page may',
    '  run from file://, where `fetch` of local files fails anyway.',
    '- Never touch `localStorage`, `sessionStorage` or IndexedDB: the app\'s',
    '  saved work lives there. Use `state()` and the document methods above.',
    '- Do not modify global objects (`Sienna`, `$`, `window`) or the DOM',
    '  outside `this.element`, except a <style> element as above and popups you',
    '  remove in `_destroy`.',
    '- No `alert`, `confirm` or `prompt`: show messages inside the panel.',
    '- Plain JavaScript a current browser runs as it is: no TypeScript, JSX or',
    '  build step. External libraries only if the user asks, and then say so.',
    '',
    '## If it goes wrong',
    '',
    'An error in the widget is shown on its panel: a red bar for an error while',
    'it runs, or a message in place of the widget if it failed as it started,',
    'each with the file and line. If the user reports one, ask for that exact',
    'text, and give the complete corrected file again, not a fragment. The user',
    'tries a changed file with Reload (on the red bar, or in Widgets > Manage',
    'added widgets...), which keeps the panels open. A file added by its path',
    'that has a syntax error is reported without a line (the browser hides it);',
    'selecting the file instead of typing its path shows the line.',
  ].join('\n');

  Sienna.widgetBrief = {
    /** The app's name, as the brief calls it. */
    setApp: function (name) { appName = name || appName; },

    /** What only the app knows: how to get at its data, its roles, its look. */
    addSection: function (title, text) {
      sections.push({ title: title, text: String(text) });
    },

    /** The whole brief, ready to paste. */
    text: function () {
      var out = GENERIC.replace(/\{APP\}/g, appName);
      sections.forEach(function (s) {
        out += '\n\n## ' + s.title + '\n\n' + s.text.replace(/\{APP\}/g, appName);
      });
      return out + '\n';
    },
  };
})(window.Sienna);
