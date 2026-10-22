/** A second example of an added widget (see dice.js). */
Sienna.widget({
  name: 'stopwatch',
  label: 'Stopwatch',
  notes: 'Start, stop and reset. An example of an added widget.',
  author: 'sienna examples',
  version: '1.0',

  widget: {
    _create: function () {
      var self = this;
      this._ms = 0;
      this._from = null;
      this._show = $('<div>').css({ fontSize: '32px', fontFamily: 'monospace', margin: '8px 0' })
        .appendTo(this.element);
      var $bar = $('<div class="slx-chrome">').appendTo(this.element);
      $('<button type="button">').text('Start / stop').on('click', function () { self._toggle(); }).appendTo($bar);
      $('<button type="button">').text('Reset').on('click', function () {
        self._ms = 0; self._from = self._from ? Date.now() : null; self._draw();
      }).appendTo($bar);
      this._timer = setInterval(function () { self._draw(); }, 100);
      this._draw();
    },
    _elapsed: function () { return this._ms + (this._from ? Date.now() - this._from : 0); },
    _toggle: function () {
      if (this._from) { this._ms = this._elapsed(); this._from = null; } else { this._from = Date.now(); }
      this._draw();
    },
    _draw: function () {
      if (!this.element[0].isConnected) { clearInterval(this._timer); return; }
      this._show.text((this._elapsed() / 1000).toFixed(1) + ' s');
    },
    _destroy: function () { clearInterval(this._timer); },
  },
});
