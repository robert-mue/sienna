/**
 * `sienna.panel` — a workspace panel: a titlebar (title + minimise / maximise /
 * close controls) plus a content area hosting a dynamically loaded widget.
 *
 * Panels are absolutely positioned. The panel tracks its "normal" geometry
 * (position + size when neither minimised nor maximised) so those states can be
 * toggled and restored, and so the workspace can persist it.
 *
 * Usage:
 *   $('<div>').panel({ title: 'Clock' });
 *   $el.panel('content');              // -> jQuery of the content element
 *   $el.panel('title', 'New');         // get/set the title
 *   $el.panel('geometry');             // -> { left, top, width, height }
 *   $el.panel('minimize');             // toggle; or ('minimize', true|false)
 *   $el.panel('maximize');             // toggle; or ('maximize', true|false)
 *
 * Classic script: uses the global jQuery (`$`) provided by the vendored
 * jquery.min.js + jquery-ui.js; no imports/exports.
 */
/** Below either of these a panel is a thumbnail: too small to work in. */
const THUMB_W = 380;
const THUMB_H = 230;

/** Where "back to the smaller size" goes when nothing was remembered. */
const THUMB_BACK_W = 300;
const THUMB_BACK_H = 200;

$.widget('sienna.panel', {
  options: {
    title: 'Panel',
    closable: true,
    draggable: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    /**
     * A path string addressing the "thing" this panel is a view of, keyed into
     * `Sienna.userData` (e.g. `'models/graph-2'`). The panel does not interpret
     * it; it is carried and persisted so a future pub/sub layer can scope
     * cross-panel updates to panels sharing the same subject.
     * @type {string}
     */
    ref: '',
    /**
     * May this panel shrink to a chrome-free miniature? A widget that IS its
     * controls has nothing left when they go, and opts out.
     */
    thumbnailable: true,
    /** {width, height} the "working size" button opens this panel at. */
    workingSize: null,
    /**
     * Stable identifier for this panel instance (e.g. `'p3'`). Normally assigned
     * by the workspace and persisted. Distinct from `ref`: `id` names the panel,
     * `ref` names what it views (several panels may share one `ref`). Used by the
     * action log / replay to target a specific panel.
     * @type {string}
     */
    id: '',
    /** @type {((panel: object) => void) | null} */
    onClose: null,
    /** Called when the panel is activated (e.g. clicked) — used to raise it. */
    onFocus: null,
    /** Called after geometry, min/max state, or ref changes — persist hook. */
    onChange: null,
  },

  _create() {
    this.element.addClass('slx-panel');
    this._minimized = false;
    this._maximized = false;
    // `ref` is a path string (a primitive) so needs no per-instance copy.
    // `id` is normally supplied by the workspace; mint a collision-free fallback
    // when the panel is created directly without one.
    this._id = this.options.id || 'p-' + Math.random().toString(36).slice(2, 8);
    // height null => content-driven until the panel is resized/restored.
    this._geom = { left: 0, top: 0, width: 260, height: null };

    this._titlebar = $('<div class="slx-panel-titlebar">').appendTo(
      this.element,
    );
    this._titleEl = $('<span class="slx-panel-title">')
      .text(this.options.title)
      .appendTo(this._titlebar);

    this._controls = $('<div class="slx-panel-controls">').appendTo(
      this._titlebar,
    );

    this._applyAccent();

    if (this.options.minimizable) {
      this._minBtn = this._controlButton('slx-panel-min').appendTo(
        this._controls,
      );
      this._on(this._minBtn, {
        click: (e) => {
          e.preventDefault();
          this.minimize();
        },
      });
    }
    // Between minimise and maximise, because that is where it sits on the size
    // ladder: minimised, thumbnail, working, maximised.
    if (this.options.thumbnailable) {
      this._workBtn = this._controlButton('slx-panel-work').appendTo(
        this._controls,
      );
      this._on(this._workBtn, {
        click: (e) => {
          e.preventDefault();
          this.workingSize();
        },
      });
    }
    if (this.options.maximizable) {
      this._maxBtn = this._controlButton('slx-panel-max').appendTo(
        this._controls,
      );
      this._on(this._maxBtn, {
        click: (e) => {
          e.preventDefault();
          this.maximize();
        },
      });
    }
    if (this.options.closable) {
      this._closeBtn = this._controlButton('slx-panel-close').appendTo(
        this._controls,
      );
      this._on(this._closeBtn, { click: '_onCloseClick' });
    }

    this._contentEl = $('<div class="slx-panel-content">').appendTo(
      this.element,
    );

    this._on(this.element, { mousedown: '_onFocus' });

    if (this.options.draggable) {
      this.element.addClass('slx-panel--draggable').draggable({
        handle: '.slx-panel-titlebar',
        cancel: '.slx-panel-controls',
        containment: 'parent',
        stack: '.slx-panel',
        stop: () => {
          if (!this._maximized) {
            this._geom.left = parseFloat(this.element.css('left')) || 0;
            this._geom.top = parseFloat(this.element.css('top')) || 0;
          }
          this._emitChange({ type: 'move', payload: this.geometry() });
        },
      });
    }
    if (this.options.resizable) {
      this.element.resizable({
        handles: 'all',
        minWidth: 160,
        minHeight: 64,
        containment: 'parent',
        stop: () => {
          if (!this._maximized && !this._minimized) {
            this._geom = this._readGeometry();
          }
          this._measure();
          this._emitChange({ type: 'resize', payload: this.geometry() });
        },
      });
    }

    // A panel is a thumbnail when it is too small to be worked in — not when
    // some state says so. The rule then explains itself, needs nothing stored,
    // and follows a drag of the resize handle continuously.
    // The observer catches size changes nobody here initiated — the window
    // resizing, a maximised neighbour. Every change we make ourselves calls
    // `_measure` directly instead of waiting for it, because an observer is not
    // a guarantee: a hidden tab runs no rendering lifecycle, so its callbacks
    // never arrive, and a state that is only ever right after a paint is not a
    // state the rest of the code can read.
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => this._measure());
      this._ro.observe(this.element[0]);
    }

    this._updateButtons();
    this._measure();
  },

  /**
   * Below `THUMB_W` wide or `THUMB_H` tall there is not enough panel left to
   * hold a toolbar AND anything to use it on, so the chrome goes and the
   * content gets the whole box. Above it, everything comes back.
   */
  _measure() {
    if (this.options.thumbnailable) {
      const w = this.element.outerWidth();
      const h = this.element.outerHeight();
      const thumb = !this._minimized && (w < THUMB_W || h < THUMB_H);
      if (thumb !== this._thumb) {
        this._thumb = thumb;
        this.element.toggleClass('slx-panel--thumb', thumb);
      }
      // AFTER the state, never before: the button's label is a function of it,
      // and refreshing first left the tooltip describing the size the panel had
      // a moment ago. Refreshed on every measure rather than only on a
      // crossing, so a resize by hand keeps the label honest too.
      this._updateButtons();
    }

    // Tell the content. A widget that redraws to fit — a diagram, a plot — has
    // to know, and its own ResizeObserver is not a dependable way to find out:
    // observers deliver on the rendering lifecycle, so they are late at best
    // and, in a tab that is not being painted, never. When the panel resized
    // ITSELF it already knows, and saying so directly is both immediate and
    // certain. The event bubbles, so a widget can listen on the panel.
    this.element.trigger('slxpanelresize', [{ thumbnail: !!this._thumb }]);
  },

  /** Is this panel currently showing as a chrome-free miniature? */
  thumbnailed() {
    return !!this._thumb;
  },

  /**
   * Grow to the size this panel is meant to be worked in — and back again.
   *
   * The button moves between the two rungs of the ladder it sits on —
   * THUMBNAIL and WORKING — and which way it goes is decided by the panel's
   * current size. Two earlier versions got this wrong in instructive ways.
   *
   * The first asked "did I grow this panel earlier?", which is invisible
   * history: after a reload, where the remembered geometry (being in memory) is
   * gone, a full-size panel grew again instead of shrinking. The second asked
   * "is it smaller than working size?" and shrank to whatever size it had been
   * before, which meant a panel at some middling size toggled between that size
   * and working size and never reached a thumbnail at all — the button had
   * stopped being a thumbnail control.
   *
   * So: a thumbnail grows to working size; anything else shrinks to a
   * thumbnail. The remembered geometry is used only when it was itself a
   * thumbnail, so a hand-sized thumbnail is preserved rather than replaced by
   * the default. The top-left corner stays put — a panel that jumped across the
   * workspace as it resized would lose the user's place — and growth is clamped
   * to the workspace so it cannot open off the edge.
   */
  workingSize(on) {
    if (this._minimized) this.minimize(false);
    if (this._maximized) this.maximize(false);

    const want = this.options.workingSize || { width: 640, height: 420 };
    const g = this.geometry();
    const grow = on === undefined ? !!this._thumb : !!on;

    if (!grow) {
      const kept = this._preWork;
      const small = (kept && (kept.width < THUMB_W || kept.height < THUMB_H))
        ? kept
        : { width: THUMB_BACK_W, height: THUMB_BACK_H };
      this._preWork = null;
      this.setGeometry({ left: g.left, top: g.top, width: small.width, height: small.height });
      this._updateButtons();
      this._emitChange({ type: 'resize', payload: this.geometry() });
      return this;
    }

    const $ws = this.element.parent();
    const maxW = $ws.length ? $ws.width() : want.width;
    const maxH = $ws.length ? $ws.height() : want.height;
    this._preWork = g;
    this.setGeometry({
      left: Math.max(0, Math.min(g.left, maxW - Math.min(want.width, maxW))),
      top: Math.max(0, Math.min(g.top, maxH - Math.min(want.height, maxH))),
      width: Math.min(want.width, maxW),
      height: Math.min(want.height, maxH),
    });
    this._updateButtons();
    this._emitChange({ type: 'resize', payload: this.geometry() });
    return this;
  },

  _controlButton(cls) {
    return $(`<button type="button" class="slx-panel-btn ${cls}">`);
  },

  /** @returns {JQuery} the content element to host a widget */
  content() {
    return this._contentEl;
  },

  /** get (no arg) or set the panel title */
  title(value) {
    if (value === undefined) {
      return this.options.title;
    }
    this.options.title = value;
    this._titleEl.text(value);
    return this;
  },

  /**
   * get (no arg) or set the panel's `ref` — the path string addressing the
   * "thing" this panel is a view of. Setting it persists.
   * @param {string} [value]
   */
  ref(value) {
    if (value === undefined) {
      return this.options.ref;
    }
    this.options.ref = value || '';
    this._applyAccent();
    this._emitChange({ type: 'ref', payload: { ref: this.options.ref } });
    return this;
  },

  /**
   * Tint the titlebar by SUBJECT: every panel viewing the same `ref` gets the
   * same colour, and a different `ref` a different one. With half a dozen
   * panels open across three documents, colour is what lets you find the ones
   * that belong together without reading a single title.
   *
   * The colour comes from a hash of the `ref`, so it is stable for the life of
   * the document and needs nothing stored. It is chosen from a PALETTE rather
   * than by taking the hash modulo 360: a raw hue is spread over values a human
   * cannot tell apart, and the first attempt at this gave three of seventeen
   * models the same hue and four more within three degrees of each other, which
   * is the failure the colour exists to prevent. Twelve hues at thirty degrees,
   * each at two lightnesses, gives 24 combinations that are all visibly
   * different from one another.
   *
   * Both lightnesses are dark enough to keep white text readable. An unbound
   * panel keeps the stylesheet's own colour — not everything is a view of
   * something.
   */
  _applyAccent() {
    const el = this.element[0];
    const ref = this.options.ref;
    if (!ref) {
      el.style.removeProperty('--slx-titlebar-bg');
      return;
    }
    // FNV-1a, then murmur3's finalizer. The mixing step is the part that
    // matters: without it, strings as similar as `models/model2` and
    // `models/model3` hash to neighbouring values and so to the same colour.
    let h = 0x811c9dc5;
    for (let i = 0; i < ref.length; i++) {
      h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;

    const slot = (h >>> 0) % 24;
    const hue = (slot % 12) * 30 + 15;
    const light = slot < 12 ? 26 : 34;
    // 38%, not the 22% this started at: at low saturation two hues thirty
    // degrees apart are both just "brown", which is no use to someone scanning
    // for a model's panels. Dark enough at either lightness that white titlebar
    // text stays above 4.5:1 on the worst hue.
    el.style.setProperty('--slx-titlebar-bg', 'hsl(' + hue + ', 38%, ' + light + '%)');
  },

  /** @returns {string} this panel's stable instance id */
  id() {
    return this._id;
  },

  /** @returns {{left:number, top:number, width:number, height:number}} normal geometry */
  geometry() {
    return {
      left: this._geom.left,
      top: this._geom.top,
      width: this._geom.width ?? this.element.outerWidth(),
      // when height is content-driven, snapshot the actual rendered height
      height: this._geom.height ?? this.element.outerHeight(),
    };
  },

  /** Apply a normal geometry (position + size). */
  setGeometry(geom) {
    this._geom = {
      left: geom.left ?? this._geom.left,
      top: geom.top ?? this._geom.top,
      width: geom.width ?? this._geom.width,
      height: geom.height ?? this._geom.height,
    };
    if (!this._maximized && !this._minimized) {
      this._applyGeometry(this._geom);
    }
    this._measure();
    return this;
  },

  minimized() {
    return this._minimized;
  },

  maximized() {
    return this._maximized;
  },

  /** Toggle (no arg) or set minimised state. Collapses to the titlebar. */
  minimize(on) {
    on = on === undefined ? !this._minimized : !!on;
    if (on === this._minimized) return this;
    if (on && this._maximized) this.maximize(false);

    this._minimized = on;
    this.element.toggleClass('slx-panel--minimized', on);
    if (on) {
      this.element.css('height', '');
      this._setResizableEnabled(false);
    } else {
      this.element.css('height', this._geom.height ?? '');
      this._setResizableEnabled(true);
    }
    this._measure();
    this._updateButtons();
    this._emitChange({ type: 'minimize', payload: { minimized: this._minimized } });
    return this;
  },

  /** Toggle (no arg) or set maximised state. Fills the workspace. */
  maximize(on) {
    on = on === undefined ? !this._maximized : !!on;
    if (on === this._maximized) return this;
    if (on && this._minimized) this.minimize(false);

    this._maximized = on;
    this.element.toggleClass('slx-panel--maximized', on);
    if (on) {
      this.element.css({ left: 0, top: 0, width: '100%', height: '100%' });
      this._setDraggableEnabled(false);
      this._setResizableEnabled(false);
    } else {
      this._applyGeometry(this._geom);
      this._setDraggableEnabled(true);
      this._setResizableEnabled(true);
    }
    this._measure();
    this._updateButtons();
    this._emitChange({ type: 'maximize', payload: { maximized: this._maximized } });
    return this;
  },

  close() {
    if (typeof this.options.onClose === 'function') {
      this.options.onClose(this);
    }
    this.destroy();
    this.element.remove();
  },

  _readGeometry() {
    return {
      left: parseFloat(this.element.css('left')) || 0,
      top: parseFloat(this.element.css('top')) || 0,
      width: this.element.outerWidth(),
      height: this.element.outerHeight(),
    };
  },

  _applyGeometry(g) {
    this.element.css({
      left: g.left,
      top: g.top,
      width: g.width ?? '',
      height: g.height ?? '',
    });
  },

  _setDraggableEnabled(on) {
    if (this.options.draggable && this.element.data('ui-draggable')) {
      this.element.draggable(on ? 'enable' : 'disable');
    }
  },

  _setResizableEnabled(on) {
    if (this.options.resizable && this.element.data('ui-resizable')) {
      this.element.resizable(on ? 'enable' : 'disable');
    }
  },

  _updateButtons() {
    if (this._minBtn) {
      this._minBtn
        .attr('aria-label', this._minimized ? 'Restore' : 'Minimize')
        .attr('title', this._minimized ? 'Restore' : 'Minimize');
    }
    if (this._workBtn) {
      const shrink = !this._thumb;
      const label = shrink ? 'Shrink to a thumbnail' : 'Open to a working size';
      this._workBtn
        .attr('aria-label', label)
        .attr('title', label)
        .toggleClass('slx-panel-shrink', shrink);
    }
    if (this._maxBtn) {
      this._maxBtn
        .attr('aria-label', this._maximized ? 'Restore' : 'Maximize')
        .attr('title', this._maximized ? 'Restore' : 'Maximize')
        .toggleClass('slx-panel-restore', this._maximized);
    }
  },

  _onCloseClick(event) {
    event.preventDefault();
    this.close();
  },

  _onFocus() {
    if (typeof this.options.onFocus === 'function') {
      this.options.onFocus(this);
    }
  },

  /**
   * Notify the host that something persist-worthy changed. `change` (optional)
   * classifies the user action for the action log:
   * `{ type: 'move'|'resize'|'minimize'|'maximize'|'ref', payload }`.
   */
  _emitChange(change) {
    if (typeof this.options.onChange === 'function') {
      this.options.onChange(this, change);
    }
  },

  _destroy() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this.options.draggable && this.element.data('ui-draggable')) {
      this.element.draggable('destroy');
    }
    if (this.options.resizable && this.element.data('ui-resizable')) {
      this.element.resizable('destroy');
    }
    this.element
      .removeClass(
        'slx-panel slx-panel--draggable slx-panel--minimized slx-panel--maximized'
          + ' slx-panel--thumb',
      )
      .empty();
  },
});
