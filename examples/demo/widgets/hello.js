/**
 * `sienna.hello` — a minimal example content widget.
 *
 * Classic script, injected on demand by the widget registry.
 */
$.widget('sienna.hello', {
  options: {
    name: 'world',
  },

  _create() {
    this.element.addClass('slx-hello');
    this._render();
  },

  _render() {
    this.element.text(`Hello, ${this.options.name}!`);
  },

  _setOption(key, value) {
    this._super(key, value);
    this._render();
  },

  _destroy() {
    this.element.removeClass('slx-hello').empty();
  },
});

window.Sienna.widgetRegistry._loaded('hello', 'hello');
