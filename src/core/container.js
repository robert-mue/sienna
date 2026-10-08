/**
 * `sienna.container` — a content widget whose content is another workspace.
 *
 * A container groups panels: "Model" and "Simulation" are each one. Its
 * children are ordinary panels in a nested `.workspace()`, so dragging,
 * resizing, min/max, thumbnails and titlebar colour all come from the existing
 * code, one level deeper — `containment: 'parent'` keeps a child inside its
 * container, and maximise fills the parent, which here means the container.
 * This file is the glue that makes the nested workspace a good citizen of the
 * one it sits in:
 *
 *   - **ids are paths.** Children mint ids under the container's own
 *     (`'p3/p0'`), so they never collide with the top level's or a sibling
 *     container's, and an action log entry names exactly one panel.
 *   - **changes and raises go up.** A move inside a container is a change to
 *     the session, and raising a panel that views a document makes that
 *     document current, wherever the panel is. Both are handed to the
 *     enclosing workspace, which is the only one the app listens to.
 *   - **children are view state.** `state()` returns them, so they are saved
 *     inside the container's own panel entry and handed back to the
 *     constructor on restore — the one and only place they are rebuilt.
 *
 * Restoring children is asynchronous (each widget script may need loading), so
 * `ready` is a promise the enclosing `addPanel` waits on: a container is not
 * open until everything in it is, or a container inside it would not yet exist
 * for whatever comes next to find.
 *
 * Not a document view and holds no user data: an arrangement of panels is
 * session state, like a panel's position.
 *
 * Classic script: uses the global jQuery (`$`) and `Sienna.widgetRegistry`.
 * Load after workspace.js. Registers itself, so loading it is all an app does
 * to have containers; an app that does not load it has none.
 */
$.widget('sienna.container', {
  options: {
    /** The children, in `workspace.serialize()` shape. */
    children: [],
  },

  _create() {
    this.element.addClass('slx-container');

    const $panel = this.element.closest('.slx-panel');
    const id = $panel.length ? $panel.panel('id') : '';
    // The workspace this container's panel sits in, if any. A container made
    // outside a workspace still works; it just has nobody to tell.
    const outer = $panel.length ? $panel.parent().workspace('instance') : null;

    this._ws = $('<div>').appendTo(this.element).workspace({
      idPrefix: id ? id + '/' : '',
      // Through the outer workspace's own `_emitChange`, not straight to its
      // callback, so a change made while the outer one is restoring is
      // suppressed with everything else it suppresses.
      onChange: () => {
        if (outer) outer._emitChange();
      },
      onRaise: (ref, $p) => {
        if (outer && typeof outer.options.onRaise === 'function') {
          outer.options.onRaise(ref, $p);
        }
      },
    });

    const children = this.options.children || [];
    this.ready = children.length
      ? this._ws.workspace('restore', children)
      : Promise.resolve();
  },

  /** The nested workspace element. */
  workspace() {
    return this._ws;
  },

  state() {
    return { children: this._ws.workspace('serialize') };
  },

  _destroy() {
    this._ws.workspace('destroy').remove();
    this.element.removeClass('slx-container');
  },
});

Sienna.widgetRegistry.register('container', {
  label: 'Container',
  title: 'Container',
  // A container IS its children; a miniature of it would be a blank box.
  thumbnail: false,
});
Sienna.widgetRegistry._loaded('container', 'container');
