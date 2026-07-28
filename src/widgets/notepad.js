/**
 * `sienna.notepad` — a free-text scratch area. `notepad('text')` gets/sets the
 * content; emits `notepadchange` on input.
 *
 * Classic script, injected on demand by the widget registry.
 */
$.widget('sienna.notepad', {
  options: {
    text: '',
    placeholder: 'Type here…',
  },

  _create() {
    this.element.addClass('slx-notepad');
    this._area = $('<textarea class="slx-notepad-area">')
      .attr('placeholder', this.options.placeholder)
      .val(this.options.text)
      .appendTo(this.element);

    this._on(this._area, {
      input: () => this._trigger('change', null, { text: this._area.val() }),
    });
  },

  /** get (no arg) or set the text */
  text(value) {
    if (value === undefined) {
      return this._area.val();
    }
    this._area.val(value);
    return this;
  },

  /** Serialisable state for persistence. */
  state() {
    return { text: this._area.val() };
  },

  _destroy() {
    this.element.removeClass('slx-notepad').empty();
  },
});

window.Sienna.widgetRegistry._loaded('notepad', 'notepad');
