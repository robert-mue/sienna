/**
 * `sienna.colorpicker` — a native colour input with a live swatch and hex
 * readout. `colorpicker('value')` gets/sets the colour; emits `colorpickerchange`.
 *
 * Classic script, injected on demand by the widget registry.
 */
$.widget('sienna.colorpicker', {
  options: {
    value: '#4c8bf5',
  },

  _create() {
    this.element.addClass('slx-colorpicker');
    this._swatch = $('<div class="slx-colorpicker-swatch">').appendTo(
      this.element,
    );
    this._input = $('<input type="color">')
      .val(this.options.value)
      .appendTo(this.element);
    this._label = $('<code class="slx-colorpicker-value">').appendTo(
      this.element,
    );

    this._on(this._input, { input: () => this._apply(this._input.val()) });
    this._apply(this.options.value);
  },

  /** get (no arg) or set the colour */
  value(value) {
    if (value === undefined) {
      return this.options.value;
    }
    this._input.val(value);
    this._apply(value);
    return this;
  },

  /** Serialisable state for persistence. */
  state() {
    return { value: this.options.value };
  },

  _apply(value) {
    this.options.value = value;
    this._swatch.css('background', value);
    this._label.text(value);
    this._trigger('change', null, { value });
  },

  _destroy() {
    this.element.removeClass('slx-colorpicker').empty();
  },
});

window.Sienna.widgetRegistry._loaded('colorpicker', 'colorpicker');
