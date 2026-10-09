/**
 * `sienna.workspace` — the region that holds panels. Panels are added
 * imperatively; each hosts a dynamically loaded content widget.
 *
 * The workspace keeps a metadata entry per panel (widget name, title, options)
 * so the whole workspace can be serialised to a plain array and restored later.
 * It calls `onRaise` when a panel is brought to the front, and `onChange`
 * whenever a panel is added, removed, moved, resized, or
 * min/maximised — the hook the app uses to persist.
 *
 * **Arrangement.** `mode` says who positions the panels:
 *   - `'floating'` (default) — each panel where the user drags it, as always;
 *   - `'tiled'` — side by side (`direction: 'row'`) or stacked (`'column'`),
 *     filling the workspace, each panel's share of it changed by dragging the
 *     divider between neighbours; a minimised panel shrinks to a strip;
 *   - `'tabbed'` — one panel showing, filling the workspace, under a strip of
 *     tabs.
 * Tiled and tabbed panels are PLACED (`panel('place', rect)`): their own
 * floating geometry is kept, so going back to floating restores it.
 *
 * Usage:
 *   $('<div>').workspace({ onChange });
 *   await $ws.workspace('addPanel', { title, widget, options });
 *   const state = $ws.workspace('serialize');
 *   await $ws.workspace('restore', state);
 *   $ws.workspace('clear');
 *
 * Classic script: uses the global jQuery (`$`) and `Sienna.widgetRegistry`;
 * no imports/exports. Load panel.js before this file.
 */
$.widget('sienna.workspace', {
  options: {
    /** @type {(() => void) | null} */
    onChange: null,
    /** Called with (ref, $panel) when a panel is brought to the front. */
    onRaise: null,
    /**
     * Prefix for minted panel ids. A workspace nested in a container panel
     * mints under that panel's id (`'p3/'`), so an id is a PATH from the top
     * level and names one panel however deep it sits.
     */
    idPrefix: '',
    /** 'floating' | 'tiled' | 'tabbed' — see the header. */
    mode: 'floating',
    /** For 'tiled': 'row' (side by side) or 'column' (stacked). */
    direction: 'row',
    /** For 'tabbed': the id of the panel showing. */
    active: null,
  },

  _create() {
    this.element.addClass('slx-workspace');
    /** @type {Array<{$panel: JQuery, widget?: string, method: ?string, title: string, options: object}>} */
    this._entries = [];
    this._z = 0;
    this._spawnCount = 0;
    this._idCounter = 0;
    this._suspend = false; // true during restore: no onChange, no action dispatch
    this._clearing = false; // true during clear(): suppress per-panel close actions
    this._active = this.options.active;
    this._dividers = [];
    this._$tabs = null;
    // A tiled or tabbed workspace must follow its own size. Whoever resizes it
    // deliberately says so (a container re-arranges on its panel's
    // `slxpanelresize`); the observer is for what nobody announces — the window.
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(() => {
        if (this.options.mode !== 'floating') this._arrange();
      });
      this._ro.observe(this.element[0]);
    }
    this._arrange();
  },

  _setOption(key, value) {
    this._super(key, value);
    if (key === 'mode' || key === 'direction') {
      this._arrange();
      this._emitChange();
    } else if (key === 'active') {
      this._active = value;
      this._arrange();
    }
  },

  /** Mint a stable, readable panel id ('p0', 'p1', …) unique in this workspace. */
  _mintId() {
    return this.options.idPrefix + 'p' + this._idCounter++;
  },

  /**
   * Move the id counter past any of these ids that are this workspace's own,
   * so a panel added later never mints one already taken — whether the taken
   * ones came from a restore or from a caller (replay) naming its panel.
   */
  _seedIds(ids) {
    const prefix = this.options.idPrefix;
    for (const id of ids) {
      if (typeof id !== 'string' || !id.startsWith(prefix)) continue;
      const m = /^p(\d+)$/.exec(id.slice(prefix.length));
      if (m) this._idCounter = Math.max(this._idCounter, Number(m[1]) + 1);
    }
  },

  /**
   * Where an id lives, relative to this workspace: `{ own }` when it names one
   * of this workspace's panels, `{ via }` with the id of the child panel whose
   * nested workspace holds it, or null when it is not under this one at all.
   */
  _locate(id) {
    const prefix = this.options.idPrefix;
    if (typeof id !== 'string' || !id.startsWith(prefix)) return null;
    const rest = id.slice(prefix.length);
    const slash = rest.indexOf('/');
    return slash < 0 ? { own: id } : { via: prefix + rest.slice(0, slash) };
  },

  /** The workspace nested in a panel (a container's), or null. */
  _nestedOf($panel) {
    const $ws = $panel.panel('content').children('.slx-workspace');
    return $ws.length ? $ws : null;
  },

  /** This workspace's own panel with this id, or null. */
  _ownPanel(id) {
    const entry = this._entries.find((e) => e.$panel.panel('id') === id);
    return entry ? entry.$panel : null;
  },

  /**
   * Dispatch a panel-level user action, unless we're mid-restore/clear or the
   * action layer isn't loaded. Keeps all suspend logic in one place.
   */
  _dispatch(type, panelId, payload) {
    if (this._suspend || this._clearing || !Sienna.actions) return;
    Sienna.actions.dispatch({ type: type, target: panelId, payload: payload });
  },

  /**
   * @param {{ title?: string, widget?: string, options?: object,
   *           closable?: boolean, draggable?: boolean, resizable?: boolean,
   *           minimizable?: boolean, maximizable?: boolean, ref?: string,
   *           id?: string, geometry?: object, minimized?: boolean,
   *           maximized?: boolean, workingSize?: {width:number, height:number} }} config
   * @returns {Promise<JQuery>} the panel element
   */
  async addPanel(config = {}) {
    const {
      title = 'Panel',
      widget,
      options = {},
      closable = true,
      draggable = true,
      resizable = true,
      minimizable = true,
      maximizable = true,
      ref = '',
      id,
      geometry,
      minimized = false,
      maximized = false,
      workingSize,
      share = 1,
    } = config;

    // An id naming a panel inside one of ours goes to the workspace that owns
    // it — which is how replay puts a recorded child back in its container.
    const where = id ? this._locate(id) : null;
    if (where && where.via) {
      const $host = this._ownPanel(where.via);
      const $nested = $host && this._nestedOf($host);
      if ($nested) return $nested.workspace('addPanel', config);
    }

    // What the widget said about itself when it registered. A caller may still
    // override — `documents` passes the size a document's panel opens at, which
    // is a better answer than the widget's own for a document.
    const spec = widget && Sienna.widgetRegistry && Sienna.widgetRegistry.spec
      ? Sienna.widgetRegistry.spec(widget) : null;

    const panelId = id || this._mintId();
    this._seedIds([panelId]);
    const $panel = $('<div>').appendTo(this.element);
    $panel.panel({
      title,
      closable,
      draggable,
      resizable,
      minimizable,
      maximizable,
      ref,
      id: panelId,
      thumbnailable: spec ? spec.thumbnail : true,
      workingSize: workingSize || (spec && spec.workingSize) || null,
      onClose: () => {
        if (this._active === panelId) {
          // The neighbour takes over the tab, the next one if there is one.
          const live = this._live();
          const i = live.findIndex((e) => e.$panel[0] === $panel[0]);
          const next = live[i + 1] || live[i - 1];
          this._active = next ? next.$panel.panel('id') : null;
        }
        this._forget($panel);
        this._arrange();
        this._dispatch('panel.close', panelId, {});
        this._emitChange();
      },
      onFocus: () => {
        this._raise($panel);
        // Bringing a panel to the front is the plainest statement there is of
        // which thing you are working on, so the host gets told. Kept as a
        // callback rather than a call into `documents`, because a workspace
        // holds panels and should not know that any of them view a document.
        // The LIVE ref, not the one this panel was made with — the same
        // reasoning as serialize()'s live title.
        if (typeof this.options.onRaise === 'function') {
          this.options.onRaise($panel.panel('ref'), $panel);
        }
      },
      onChange: (w, change) => {
        // Minimising frees space a tiled neighbour should take.
        if (change && change.type === 'minimize') this._arrange();
        if (change) {
          this._dispatch('panel.' + change.type, panelId, change.payload);
        }
        this._emitChange();
      },
    });

    // A geometry saying only how BIG is not a position: size the panel, but let
    // it cascade like any other, or every document opened from the File menu
    // lands in one stack at the top-left. Restore passes a full geometry and so
    // keeps its exact place, which is the whole point of restoring.
    if (geometry && (geometry.left != null || geometry.top != null)) {
      $panel.panel('setGeometry', geometry);
    } else {
      this._place($panel);
      if (geometry) $panel.panel('setGeometry', geometry);
    }
    this._raise($panel);

    const entry = {
      $panel,
      widget,
      method: null,
      title,
      options: { ...options },
      share,
    };
    this._entries.push(entry);
    // A panel the user opens is the one they want to see. One being restored
    // is not; the stored choice stands.
    if (!this._suspend) this._active = panelId;
    this._arrange();

    if (widget) {
      const method = await Sienna.widgetRegistry.loadWidget(widget);
      entry.method = method;
      const inst = $panel.panel('content')[method]({ ...options })[method]('instance');
      // A widget with more to build after its constructor — a container
      // restoring its children — says so with a `ready` promise, and the panel
      // is not open until it settles.
      if (inst && inst.ready && typeof inst.ready.then === 'function') {
        await inst.ready;
      }
    }

    if (minimized) $panel.panel('minimize', true);
    if (maximized) $panel.panel('maximize', true);

    this._dispatch('panel.add', panelId, {
      widget: widget || null,
      ref: ref,
      title: title,
    });
    this._emitChange();
    return $panel;
  },

  /** @returns {JQuery[]} currently open panels */
  panels() {
    return this._entries.map((e) => e.$panel);
  },

  /** @returns {?string} the widget a panel is hosting, or null for a bare panel */
  widgetOf($panel) {
    const entry = this._entries.find((e) => e.$panel[0] === $panel[0]);
    return entry ? (entry.widget || null) : null;
  },

  /**
   * @returns {?JQuery} the open panel with this id, or null. An id is a path
   *   (`'p3/p0'`), so this finds a panel inside a container too.
   */
  panelById(id) {
    const where = this._locate(id);
    if (!where) return null;
    if (where.own) return this._ownPanel(where.own);
    const $host = this._ownPanel(where.via);
    const $nested = $host && this._nestedOf($host);
    return $nested ? $nested.workspace('panelById', id) : null;
  },

  /**
   * Snapshot every panel (widget, title, id, ref, merged options + widget
   * state, geometry, min/max flags) as a plain, JSON-serialisable array.
   */
  serialize() {
    return this._entries
      .filter((e) => e.$panel[0].isConnected)
      .map((e) => {
        const inst = e.method
          ? e.$panel.panel('content')[e.method]('instance')
          : null;
        const state =
          inst && typeof inst.state === 'function' ? inst.state() : {};
        return {
          widget: e.widget,
          // The LIVE title, not the one addPanel was given: a title can be
          // changed after the fact (`$panel.panel('title', …)`), and reading
          // the stale entry meant such a change was lost on the next reload.
          title: e.$panel.panel('title'),
          id: e.$panel.panel('id'),
          ref: e.$panel.panel('ref'),
          options: { ...e.options, ...state },
          geometry: e.$panel.panel('geometry'),
          share: e.share,
          minimized: e.$panel.panel('minimized'),
          maximized: e.$panel.panel('maximized'),
        };
      });
  },

  /** Rebuild the workspace from a serialised array (replaces current panels). */
  async restore(list) {
    this.clear();
    this._suspend = true;
    // Seed the id counter past any restored ids so new panels can't collide.
    this._seedIds(list.map((item) => item && item.id));
    try {
      for (const item of list) {
        await this.addPanel(item);
      }
    } finally {
      this._suspend = false;
    }
    this._emitChange();
  },

  clear() {
    this._clearing = true;
    try {
      for (const $panel of this.panels()) {
        $panel.panel('close');
      }
    } finally {
      this._clearing = false;
    }
    this._entries = [];
    this._arrange();
    // Reset id minting: with no live panels there's nothing to collide with, and
    // starting from 'p0' again lets a replay's panels line up with recorded ids.
    // (restore() re-seeds the counter past any ids it restores.)
    this._idCounter = 0;
  },

  /** Lay the panels out again, per the mode. Cheap; call it when in doubt. */
  arrange() {
    this._arrange();
  },

  /** @returns {{mode:string, direction:string, active:?string}} for saving */
  arrangement() {
    return { mode: this.options.mode, direction: this.options.direction, active: this._active };
  },

  /** Show one of this workspace's panels — its tab, when tabbed. */
  activate(id) {
    this._active = id;
    this._arrange();
    this._emitChange();
  },

  /** Set a tiled panel's share of the space (relative to its neighbours'). */
  share(id, value) {
    const entry = this._live().find((e) => e.$panel.panel('id') === id);
    if (!entry) return;
    entry.share = value;
    this._arrange();
    this._emitChange();
  },

  _live() {
    return this._entries.filter((e) => e.$panel[0].isConnected);
  },

  _arrange() {
    const mode = this.options.mode;
    const row = this.options.direction !== 'column';
    this.element
      .toggleClass('slx-workspace--tiled', mode === 'tiled')
      .toggleClass('slx-workspace--row', mode === 'tiled' && row)
      .toggleClass('slx-workspace--column', mode === 'tiled' && !row)
      .toggleClass('slx-workspace--tabbed', mode === 'tabbed');
    const live = this._live();
    if (mode !== 'tabbed') {
      if (this._$tabs) { this._$tabs.remove(); this._$tabs = null; }
      for (const e of live) e.$panel.removeClass('slx-panel--hidden');
    }
    if (mode !== 'tiled') this._setDividers(0);

    if (mode === 'tiled') this._arrangeTiled(live, row);
    else if (mode === 'tabbed') this._arrangeTabbed(live);
    else for (const e of live) e.$panel.panel('place', null);
  },

  /**
   * Side by side or stacked, filling the workspace. A minimised panel takes a
   * strip the height of a titlebar; the rest share what is left in proportion
   * to `share`, with a draggable divider in each gap.
   */
  _arrangeTiled(live, row) {
    const GAP = 6;
    const W = this.element.innerWidth();
    const H = this.element.innerHeight();
    const total = row ? W : H;
    const n = live.length;
    const $bar = live.length ? live[0].$panel.children('.slx-panel-titlebar') : $();
    const strip = ($bar.is(':visible') && $bar.outerHeight()) || 34;
    const min = (e) => e.$panel.panel('minimized');
    const flex = live.filter((e) => !min(e));
    const sum = flex.reduce((a, e) => a + e.share, 0) || 1;
    const avail = Math.max(0, total - GAP * (n - 1) - strip * (n - flex.length));

    this._setDividers(Math.max(0, n - 1));
    let pos = 0;
    live.forEach((e, i) => {
      const size = min(e) ? strip : (avail * e.share) / sum;
      const a = Math.round(pos);
      const b = Math.round(pos + size);
      e.$panel.panel('place', row
        ? { left: a, top: 0, width: b - a, height: H }
        : { left: 0, top: a, width: W, height: b - a });
      pos += size;
      if (i < n - 1) {
        const at = Math.round(pos);
        this._dividers[i]
          .css(row
            ? { left: at, top: 0, width: GAP, height: H }
            : { left: 0, top: at, width: W, height: GAP })
          .toggleClass('slx-divider--inert', min(e) || min(live[i + 1]));
        pos += GAP;
      }
    });
  },

  /** Keep exactly `n` dividers, each knowing which gap it is. */
  _setDividers(n) {
    while (this._dividers.length > n) this._dividers.pop().remove();
    while (this._dividers.length < n) {
      const $d = $('<div class="slx-divider">').appendTo(this.element);
      $d.attr('data-gap', this._dividers.length);
      this._dividers.push($d);
      $d.on('pointerdown', (ev) => this._dragDivider(ev, Number($d.attr('data-gap'))));
    }
  },

  /**
   * Drag the divider in gap `i`: the panels either side trade space and the
   * rest stay put. Shares are relative, so the pair's total share is kept and
   * split in the ratio of their new sizes.
   */
  _dragDivider(ev, i) {
    const live = this._live();
    const a = live[i];
    const b = live[i + 1];
    if (!a || !b || a.$panel.panel('minimized') || b.$panel.panel('minimized')) return;
    ev.preventDefault();
    const row = this.options.direction !== 'column';
    const size = ($p) => (row ? $p.outerWidth() : $p.outerHeight());
    const pa = size(a.$panel);
    const pb = size(b.$panel);
    const pair = a.share + b.share;
    const start = row ? ev.clientX : ev.clientY;
    const MIN = 60;
    const el = ev.currentTarget;
    try { el.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic event */ }
    const move = (e) => {
      const d = (row ? e.clientX : e.clientY) - start;
      const na = Math.max(MIN, Math.min(pa + pb - MIN, pa + d));
      a.share = (pair * na) / (pa + pb);
      b.share = pair - a.share;
      this._arrange();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      this._dispatch('panel.share', a.$panel.panel('id'), { share: a.share });
      this._dispatch('panel.share', b.$panel.panel('id'), { share: b.share });
      this._emitChange();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  },

  /**
   * One panel showing, under a strip of tabs. The panels' own titlebars are
   * hidden — the tab is the titlebar: title, subject colour, close.
   */
  _arrangeTabbed(live) {
    if (!this._$tabs) {
      this._$tabs = $('<div class="slx-tabs">').prependTo(this.element);
    }
    if (!live.some((e) => e.$panel.panel('id') === this._active)) {
      this._active = live.length ? live[live.length - 1].$panel.panel('id') : null;
    }
    this._$tabs.empty();
    for (const e of live) {
      const id = e.$panel.panel('id');
      const $tab = $('<div class="slx-tab">')
        .toggleClass('slx-tab--active', id === this._active)
        .attr('title', e.$panel.panel('title'))
        .appendTo(this._$tabs);
      const accent = e.$panel[0].style.getPropertyValue('--slx-titlebar-bg');
      if (accent) $tab.css('--slx-tab-accent', accent);
      $('<span class="slx-tab-title">').text(e.$panel.panel('title')).appendTo($tab);
      const $close = $('<button type="button" class="slx-tab-close" aria-label="Close" title="Close">')
        .appendTo($tab);
      $tab.on('mousedown', (ev) => {
        if ($(ev.target).closest('.slx-tab-close').length) return;
        if (id === this._active) return;
        this._dispatch('panel.activate', id, {});
        this.activate(id);
        if (typeof this.options.onRaise === 'function') {
          this.options.onRaise(e.$panel.panel('ref'), e.$panel);
        }
      });
      $close.on('click', (ev) => {
        ev.preventDefault();
        e.$panel.panel('close');
      });
    }
    const top = this._$tabs.outerHeight();
    const rect = {
      left: 0, top, width: this.element.innerWidth(),
      height: Math.max(0, this.element.innerHeight() - top),
    };
    for (const e of live) {
      const on = e.$panel.panel('id') === this._active;
      // Shown BEFORE placing, so placing measures it — the announcement a
      // widget drawing to fit has been waiting for while its tab was hidden.
      e.$panel.toggleClass('slx-panel--hidden', !on);
      if (on && e.$panel.panel('minimized')) e.$panel.panel('minimize', false);
      e.$panel.panel('place', rect);
    }
  },

  /** Cascade panels so a fresh one is offset from the last. */
  _place($panel) {
    const gap = 28;
    const step = this._spawnCount % 8;
    this._spawnCount += 1;
    $panel.panel('setGeometry', {
      left: 16 + step * gap,
      top: 16 + step * gap,
    });
  },

  /** Bring a panel to the front. */
  _raise($panel) {
    this._z += 1;
    $panel.css('z-index', this._z);
  },

  _forget($panel) {
    this._entries = this._entries.filter((e) => e.$panel[0] !== $panel[0]);
  },

  _emitChange() {
    if (this._suspend) return;
    if (typeof this.options.onChange === 'function') {
      this.options.onChange();
    }
  },

  _destroy() {
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.clear();
    this._setDividers(0);
    if (this._$tabs) { this._$tabs.remove(); this._$tabs = null; }
    this.element.removeClass('slx-workspace').empty();
  },
});
