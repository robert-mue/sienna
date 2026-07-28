# sienna

A static jQuery single-page app: a customisable menu and a workspace of
draggable / resizable / minimisable / maximisable panels, where each panel hosts
a dynamically loaded jQuery UI widget. It also has a user-data model layer with
autosave, undo/redo, live-syncing views, and session replay. Open panels persist
across reloads.

## Running

No build, no server, no dependencies to install. Just open the file:

```
Double-click index.html  (or:  google-chrome index.html)
```

Everything is plain HTML/CSS/JS with vendored jQuery + jQuery UI in `vendor/`.

## Using it

**Panels**

- Drag a panel by its titlebar; resize from any edge/corner.
- Titlebar buttons: **—** minimise, **▢** maximise, **×** close.
- Your open panels (and their contents) are saved to the browser and restored on reload.

**Menus**

- **File** — work with *models* (the app's user data):
  - **New** creates a model and opens a panel viewing it; **Open** re-opens an
    existing model. Open the same model twice and the two views stay in sync.
  - **Save As** duplicates a model. There's no "Save" — everything autosaves to
    the browser continuously.
  - **Export / Import** a single model, or **Export all / Import all** the whole
    store, as JSON files.
- **Edit** — **Undo / Redo** your changes (also `Ctrl/Cmd-Z` and
  `Ctrl/Cmd-Shift-Z`). Undo covers data edits, not window layout.
- **Widgets** — open standalone panels (Clock, Greeting, Counter, Notepad,
  Colour picker).
- **Session** — **Replay** your session (re-performs what you did, like a video),
  or **Export / Import log** the recorded action log as JSON.
- **View ▸ Clear workspace** removes all panels.

## Design & internals

The app has grown a layer for **user-data models, an action log, undo/redo, and
session replay**. For the rationale, terminology, and decisions behind it — a
good basis for picking the project back up — see **[DESIGN.md](DESIGN.md)**.
For module responsibilities and the script load order, see
[CLAUDE.md](CLAUDE.md).
