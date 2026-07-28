/**
 * `sienna.menu` — a customisable menu bar driven by a config of items. Each
 * item has a `label` and either an `onSelect(item, widget)` callback, a nested
 * `items` array (submenu), or both.
 *
 * Note: only the jQuery UI *widget factory* is loaded (not jQuery UI's own
 * `menu` widget), so this `.menu()` plugin name does not collide.
 *
 * Usage:
 *   $('<div>').menu({ items: [{ label: 'Clock', onSelect: () => {...} }] });
 *   $menu.menu('items', newItems);   // replace items
 *   $menu.menu('addItem', item);     // append one
 *
 * Classic script: uses the global jQuery (`$`); no imports/exports.
 */
$.widget('sienna.menu', {
  options: {
    /** @type {Array<{ label: string, onSelect?: Function, items?: Array }>} */
    items: [],
  },

  _create() {
    this.element.addClass('slx-menu');
    this._listEl = $('<ul class="slx-menu-list">').appendTo(this.element);
    this._render();

    // Submenus open on hover/focus (CSS). After a selection we mark the
    // top-level item so its submenu is suppressed; moving the pointer off
    // that item clears the mark so hover works again next time.
    this._on(this._listEl, {
      'mouseleave > .slx-menu-item': function (event) {
        $(event.currentTarget).removeClass('slx-suppress');
      },
    });
  },

  /** get (no arg) or replace the menu items */
  items(value) {
    if (value === undefined) {
      return this.options.items;
    }
    this.options.items = value;
    this._render();
    return this;
  },

  addItem(item) {
    this.options.items.push(item);
    this._render();
    return this;
  },

  _render() {
    this._listEl.empty();
    for (const item of this.options.items) {
      this._renderItem(item, this._listEl);
    }
  },

  _renderItem(item, $container) {
    const $li = $('<li class="slx-menu-item">').appendTo($container);
    const $label = $('<button type="button" class="slx-menu-label">')
      .text(item.label)
      .appendTo($li);

    if (typeof item.onSelect === 'function') {
      this._on($label, {
        click: (event) => {
          event.preventDefault();
          // Close the menu: suppress the enclosing top-level item's submenu
          // and drop focus so :focus-within doesn't keep it open.
          $label
            .closest('.slx-menu-list > .slx-menu-item')
            .addClass('slx-suppress');
          $label.trigger('blur');
          // Route the selection through the action dispatcher so it is logged
          // and any userData effects it causes are captured. (Guarded so the
          // menu still works if actions.js isn't loaded.)
          const invoke = () => item.onSelect(item, this);
          if (Sienna.actions) {
            Sienna.actions.dispatch(
              { type: 'menu.select', target: item.label, payload: {} },
              invoke,
            );
          } else {
            invoke();
          }
        },
      });
    }

    if (Array.isArray(item.items) && item.items.length) {
      $li.addClass('slx-has-submenu');
      const $submenu = $('<ul class="slx-submenu">').appendTo($li);
      for (const child of item.items) {
        this._renderItem(child, $submenu);
      }
    }
  },

  _destroy() {
    this.element.removeClass('slx-menu').empty();
  },
});
