/**
 * An example of a widget that is NOT built into an app: the user adds it
 * from Widgets ▸ Add a widget…, giving this file's URL (or choosing it). The
 * whole widget is one call to `Sienna.widget`.
 */
Sienna.widget({
  name: 'dice',
  label: 'Dice',
  title: 'Dice',
  notes: 'Rolls a die. An example of an added widget.',
  author: 'sienna examples',
  version: '1.0',
  contract: 1,
  options: { sides: 6 },

  widget: {
    options: { sides: 6, value: null },

    _create: function () {
      var self = this;
      this.element.addClass('ex-dice');
      this._face = $('<div class="ex-dice-face">').css({
        fontSize: '48px', fontWeight: 600, textAlign: 'center', margin: '10px 0',
      }).appendTo(this.element);
      $('<button type="button" class="slx-chrome">').text('Roll').on('click', function () {
        self.options.value = 1 + Math.floor(Math.random() * self.options.sides);
        self._show();
      }).appendTo(this.element);
      this._show();
    },

    _show: function () {
      this._face.text(this.options.value == null ? '–' : this.options.value);
    },

    // Kept with the panel, so the last roll survives a reload.
    state: function () {
      return { value: this.options.value };
    },
  },
});
