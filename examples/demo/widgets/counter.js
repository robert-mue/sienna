/**
 * `sienna.counter` — increment/decrement counter, and the pilot for the
 * `$.sienna.widgetBase` model-binding contract.
 *
 * When the host panel has a `ref` (opened via File ▸ New / Open) the count lives
 * in that model at `<ref>/count`, so it persists via userData and is shared by
 * any panel viewing the same model — the counter watches its model (`_watchModel`)
 * and re-renders when it changes, so sibling views and undo update live. When
 * unbound (opened via the Widgets menu) it keeps a local count persisted through
 * the panel's `state()`/options, as before. Either way each bump is dispatched
 * as a logged `counter.change` action, captured for the log and (bound) for undo.
 *
 * Classic script, injected on demand by the widget registry.
 */
$.widget('sienna.counter', $.sienna.widgetBase, {
  options: {
    start: 0,
    step: 1,
  },

  _create() {
    this.element.addClass('slx-counter');
    this._count = this._bound() ? this._readModel() : this.options.start;

    this._valueEl = $('<span class="slx-counter-value">').appendTo(
      this.element,
    );
    const $controls = $('<div class="slx-counter-controls">').appendTo(
      this.element,
    );
    this._decBtn = $(
      '<button type="button" aria-label="Decrement">&minus;</button>',
    ).appendTo($controls);
    this._incBtn = $(
      '<button type="button" aria-label="Increment">+</button>',
    ).appendTo($controls);

    this._on(this._decBtn, { click: () => this._bump(-this.options.step) });
    this._on(this._incBtn, { click: () => this._bump(this.options.step) });

    // Bound: re-render whenever the model changes (siblings, undo, import).
    if (this._bound()) {
      this._watchModel(this._refresh);
    }

    this._render();
  },

  /** Re-read the count from the model and repaint (model-change handler). */
  _refresh() {
    this._count = this._readModel();
    this._render();
  },

  /** @returns {number} current value */
  value() {
    return this._count;
  },

  /**
   * View state for persistence. Bound: the count lives in the model (userData),
   * so nothing to store here. Unbound: persist the count via the `start` option.
   */
  state() {
    return this._bound() ? {} : { start: this._count };
  },

  /** Read the count from the model, defaulting to the `start` option. */
  _readModel() {
    const v = this._get('count');
    return typeof v === 'number' ? v : this.options.start;
  },

  _bump(delta) {
    this._action('change', { delta }, () => {
      const base = this._bound() ? this._readModel() : this._count;
      this._count = base + delta;
      if (this._bound()) this._set('count', this._count);
    });
    this._render();
    this._trigger('change', null, { value: this._count });
  },

  _render() {
    this._valueEl.text(this._count);
  },

  _destroy() {
    this.element.removeClass('slx-counter').empty();
  },
});

window.Sienna.widgetRegistry._loaded('counter', 'counter');
