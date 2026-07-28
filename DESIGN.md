# Design

A decision record and restart guide for **sienna** — the whole story, from the
base single-page app through the later user-data / logging / undo / replay layer.
`CLAUDE.md` documents *what each module is and how to work in the repo*; this file
captures *why it's shaped this way* and *how we got here*, so a fresh session
(human or AI) can pick up with the reasoning intact.

Status: base app complete; **all planned phases 0–6 of the data/logging layer
complete** (2026-07-22). Three deferred tasks remain — see §14.

- **Part I — The base app** (§§1–7): a static jQuery SPA of a menu + a workspace
  of panels hosting dynamically loaded widgets.
- **Part II — Logging, user data, undo & replay** (§§8–15): the layer that
  captures user data, records interactions, and adds undo/redo and replay.

---

# Part I — The base app

## 1. Concept and shape

sienna is a **customisable menu** plus a **workspace** that holds **panels**.
Each panel is a titlebar + a content area, and the content is a **widget built
with the jQuery UI widget factory**. Panels are draggable, resizable,
minimisable, maximisable, closable, and their layout + contents persist across
reloads. Widgets are **loaded dynamically** (only when first used).

The whole thing is deliberately small and framework-free: plain jQuery, no
front-end framework, no components beyond the jQuery UI widget factory.

## 2. Why static — the constraint that shaped everything

sienna runs by **opening `index.html` directly** (`file://`) — **no build, no
server, no npm**. This one requirement drove most of the base-app decisions,
because browsers restrict `file://`:

- **Classic `<script>` tags only — no ES modules, no `import`/`export`.** Browsers
  block ES modules (and `fetch`/`import()`) over `file://`. So modules communicate
  through a **single global `window.Sienna`** namespace, and jQuery is the global
  `$`/`jQuery` from vendored scripts.
- **Vendored libraries.** jQuery and a hand-assembled subset of jQuery UI live in
  `vendor/` (no package manager). The jQuery UI bundle is only the pieces needed:
  the widget factory + mouse/data/plugin/scroll-parent helpers + **draggable** and
  **resizable** — notably *not* jQuery UI's own `menu` widget, which is why our
  `.menu()` / `.workspace()` / `.panel()` plugin names don't collide.
- **`file://` still allows `localStorage`**, so persistence works without a server
  (see §5).

(Historical note: an early version used Vite/ESM and broke on double-click. The
user clarified they wanted a *static* app from the start, and it was converted to
classic scripts + vendored libs. Lesson baked in: the static constraint is
primary, not incidental.)

## 3. Dynamic widget loading

"Widgets load dynamically" is met by **injecting a classic `<script>` tag** on
first use — **not** `import()`, which is blocked over `file://`. When the injected
script runs, it self-registers via `$.widget('sienna.<name>', …)` and reports the
plugin method name back to the registry. Load order in `index.html` matters and is
dependency-ordered; content-widget scripts are the exception — they're *not*
listed, they're injected on demand.

## 4. The widget registry and manifest (DRY)

`Sienna.widgetRegistry` is the **single source of truth** for which widgets
exist: each `register(name, { src, label, title, options })` records a widget's
script URL plus its menu presentation. `src/widgets/index.js` is the **manifest** —
the one place listing the app's widgets.

A deliberate refactor: the Widgets menu is **built generically from
`widgetRegistry.list()`**, so `main.js` holds no per-widget knowledge — adding a
widget is a single registration in the manifest. This cleanly separates the
*application-specific* list of widgets from the *generic* menu-building code, and
avoids duplicating the list (DRY). The same principle later shaped the File menu
(built from the model list) and replay (built from a handler registry).

## 5. Persistence

Layout persists via `Sienna.persistence`: a guarded localStorage read/write of
the serialised workspace under a versioned key. "Guarded" means a disabled / full
/ corrupt store (or a browser restricting storage on `file://`) degrades to "no
persistence" rather than throwing. The workspace serialises each panel (widget,
title, geometry, min/max state, and — via a widget's optional `state()` method —
its contents) so a reload round-trips the whole workspace.

## 6. Cross-browser and vendoring notes

- **jQuery UI `resizable` needs handle-placement CSS**, shipped in `styles.css` —
  without it, resizing silently no-ops. (A trap worth remembering if the vendor
  bundle is ever regenerated.)
- **Firefox stacking fix.** A menu dropdown appeared *behind* panels in Firefox
  (fine in Chrome) — a CSS stacking-context issue. Resolved by giving the menu a
  high `z-index` and giving the workspace its own stacking context so panels are
  contained and can never paint over the dropdown at any z-index.

## 7. Content-widget contract (base)

A content widget: (1) registers itself with `$.widget('sienna.<name>', {…})`
using the global `$`; (2) at the end calls
`Sienna.widgetRegistry._loaded('<name>', '<method>')`; (3) is listed in the
manifest. Optionally it implements `state()` returning a JSON-serialisable object
merged into the panel's stored options for persistence. Part II extends this
contract for widgets that hold shared *user data* (see §11).

---

# Part II — Logging, user data, undo & replay

## 8. What this layer is

Three interlinked mechanisms, all meant to work **in the background** so a widget
author barely touches them:

1. **Capture changes to user data** — the application's data (e.g. graphs).
2. **A JSON log of user interactions** — savable, hand-editable, re-loadable —
   serving three purposes: (a) replay a session like a video, (b) UI testing
   ("after these steps, do we reach this screen?"), (c) a future interactive
   tutorial.
3. **Unlimited undo/redo.**

## 9. The unifying idea

Treat all three as views onto **one ordered stream of events** (event-sourcing
*lite*). If every state change flows through a single spine:

- the **interaction log** *is* the recorded stream,
- **model-change capture** is the subset that mutates data,
- **undo/redo** is navigating the stream and applying inverses.

Building three ad-hoc mechanisms would have them fighting each other; one spine
makes each a small view. This is the single most important architectural call of
Part II.

```
        user gesture
             │
      actions.dispatch ─────────► subscribe() ──► recorder ──► log ─► save / replay
             │  (opens a txn)
             ▼
       widget fn / framework
             │
       userData.set(ref,…) ──► change {ref,prior,value}
             │                        │
   collected into entry.changes       ├─► subscribe(prefix) ─► pub/sub → sibling panels refresh
             │                        │
             ▼                        └─► (captured in the txn)
      history records txn
```

## 10. Terminology (settled deliberately)

| term | meaning |
|---|---|
| **`Sienna.userData`** | the single global container of *all* user data. Autosaved to localStorage. Framework speaks only path strings into it. |
| **model** | one entry, e.g. `userData.models['graph-2']`. `models` is just an *app-specific property* of `userData` (which could also hold e.g. a shared `ontology`) — the generic core never names it. |
| **`ref`** | a **path string** on a panel addressing what it views, e.g. `'models/graph-2'`. Replaced the old opaque `context` object. |
| **`id`** | a panel's stable instance id (`'p3'`). **`id` names the panel; `ref` names what it views** — several panels may share one `ref`. |
| **action / entry** | one recorded interaction: `{ seq, ts, type, target, payload, changes }`. |
| **transaction** | the userData `changes` one action caused — the unit of undo. |

Naming rationale worth keeping: the panel pointer is `ref`, **not** `userData`,
because a panel doesn't *hold* user data — it holds a *pointer into* it. Calling
it `userData` would read as "this panel's data," the one thing it isn't.

## 11. Key decisions and their rationale

- **Explicit store API, not a `Proxy`.** `userData.set/update/remove` are the
  only mutation entry points. A Proxy would be more "transparent," but the whole
  point of the log and undo is discrete, *named*, serialisable changes — which a
  Proxy just reconstructs after the fact. Explicit wins.

- **There was no model object to begin with.** `context` was only a *reference*
  pointing at a thing that didn't exist in code. So "capture user data" first
  meant *building the store* (Phase 1) — which conveniently is also the pub/sub
  substrate.

- **`ref` is an identity, effectively immutable.** A different subject = close the
  panel and open a new one. So pub/sub can treat the `ref` string as a stable key
  and needn't handle `ref` *changes*.

- **The interaction log is semantic, not raw DOM.** The "save to file, hand-edit,
  reload" requirement forbids recording pixel clicks / `nth-child` selectors. So
  actions are `{type:'counter.change', target:'p3', payload:{delta:1}}`, which a
  human can read and edit. This forced the command/dispatch shape.

- **Auto-capture what the framework owns; one small opt-in for the rest.** Menu
  selections, panel add/close/move/resize/min/max are logged for *free* (the
  framework already owns those callbacks). A widget's own actions cost **one
  line**: `_action(name, payload, run)`. The whole extra widget contract is a
  sentence — *put shared data in the model via `_set`, wrap user actions in
  `_action`*. (A DOM-delegation fallback for un-instrumented widgets was
  considered and deferred.)

- **`changes` ties (1) into (2) into (3).** `dispatch(action, run)` opens a
  userData "transaction": while `run` executes, every userData change is captured
  into `entry.changes`. That array is the audit trail the log carries and the
  thing undo reverses.

- **Undo is transaction-grouped and userData-scoped.** One user action that
  touched three paths undoes as **one** step (the action is the unit, not the
  individual `set`). Scope is **userData only** — layout (panel move/resize/open)
  is *not* undone; `history.scope` is left as the seam to allow that later. We
  chose command-inverse (before/after values) over whole-workspace snapshots:
  snapshots are simpler but coarse and visually jarring (they rebuild every
  panel).

- **localStorage is primary and autosaved; files are secondary.** Every userData
  mutation writes through to localStorage, so there is **no "Save"** — durability
  is continuous. The File menu is about model *lifecycle* and *file interchange*
  (export/import), not saving. Two separate localStorage domains that never mix:
  session/layout (`sienna.workspace.v1`, as before) and user data
  (`sienna.userData.v1`). **userData excludes session state** by decision.

- **Pub/sub is opt-in and was explicitly gated.** A widget lives-updates by
  calling `_watchModel(handler)` once; it re-renders on any change at/under its
  `ref`, so sibling panels sharing a `ref` sync and undo/import show visibly.
  widgetBase does *not* auto-subscribe — the user asked that pub/sub not be built
  until requested, so it's a separate, green-lit step (Phase 4.5).

- **Replay re-performs, from a clean start.** `actions.replay` walks a log with
  recording suppressed; each entry is re-performed by a handler
  (`onReplay(type, fn)` — app registers layout handlers like `panel.add`) or, with
  no handler, by re-applying its captured `changes` (which via `_watchModel`
  re-renders widgets, so model edits replay for free). It assumes a cleared
  workspace/userData so freshly-minted panel ids line up with recorded ones; it
  does **not** reconstruct actions with no per-item events (Clear workspace) or
  `panel.ref` changes. **Non-determinism caveat:** time/random widgets (the clock)
  won't reproduce pixel-identically — relevant to "reach this exact screen"
  testing.

## 12. Build phases (the journey, as shipped)

Each phase was a branch → verified in headless Chrome → fast-forward-merged to
`main` → pushed. Every phase left the app runnable.

| # | commit | delivered |
|---|--------|-----------|
| 0 | `ed865d1` | rename panel `context` → `ref` (path string) + stable panel `id` |
| 1 | `59a4139` | `Sienna.userData` store — autosave + change events (pub/sub substrate); `persistence.js` generalised with `readJSON/writeJSON/removeKey` |
| 2 | `b5a2a37` | `Sienna.models` app layer + File menu (plumbing only) |
| 3 | `35c5a5e` | `Sienna.actions` dispatch spine + recorder; auto-capture in menu/panel/workspace |
| 4 | `7223be6` | `$.sienna.widgetBase` + model-bound `counter` pilot; File New/Open open a model view |
| 4.5 | `bd56491` | `_watchModel` pub/sub — live sibling sync |
| 5 | `554458f` | `Sienna.history` — transaction-grouped, userData-scoped undo/redo; Edit menu + Ctrl/Cmd-Z |
| 6 | `40ad6d6` | `actions.replay` + `onReplay`; Session menu; shared `Sienna.files`; `workspace.panelById` |

## 13. How it was verified (no test suite)

sienna has **no automated tests, no build, no server** — it runs from `file://`.
Each phase was checked by driving the real app in **headless Chrome**:

```
google-chrome --headless=new --no-sandbox --disable-gpu \
  --virtual-time-budget=8000 --dump-dom "file://…/index.html"
```

A throwaway `_phaseN_test.html` (loaded the real scripts + an inline assertion
script that wrote `PASS`/`FAIL` into a `<pre>`, read back via `--dump-dom`) proved
each phase, then was deleted. The CDP-over-websocket approach was blocked by the
sandbox, hence the `--dump-dom` harness. Note: `node` is via **nvm** — `source
~/.nvm/nvm.sh` before `node`/`npm` in tool calls.

## 14. Deferred — not started; do only if asked

1. **Interactive tutorial** — a consumer of the replay stream that tells the user
   the next step and checks they perform it.
2. **DOM-delegation fallback** — auto-log clicks in widgets that don't extend
   `$.sienna.widgetBase`.
3. **Layout-scope undo** — flip `Sienna.history.scope` to `'all'` so panel
   moves/opens/closes undo too (the seam exists).

## 15. Restarting

- Run it: open `index.html` (double-click or `google-chrome index.html`). No
  server/npm.
- Try the arc end-to-end: **File ▸ New** (opens a model-bound counter) → increment
  it → **Edit ▸ Undo/Redo** (or Ctrl/Cmd-Z) → open the same model again to see two
  synced views → **Session ▸ Replay** to re-perform the session → **Session ▸
  Export log** to save the JSON.
- Read `CLAUDE.md` for module responsibilities and the load order; read this file
  for the *why*. The full multi-phase plan and decisions also live in Claude's
  project memory.
