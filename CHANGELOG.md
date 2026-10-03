# Changelog

## 0.7.0-beta.1

Settings UI only. No change to the outline, the overlay, the minimap or any
default — `src/overlay.ts`, `src/outline.ts`, `src/markdown.ts`, `src/dom.ts`
and `src/types.ts` are byte-identical to 0.6.0-beta.1.

### Changed

- **Settings are split into basic and advanced.** Seven settings now sit on the
  root page: Show, Outline mode, Side, Open the popover on, Show minimap, Note
  header button, and Hide minimap on phones. Everything else moved behind a
  single **Advanced** entry that opens a sub-page.
- **The advanced page is grouped and collapsible.** Content, Appearance,
  Minimap and Behavior each collapse from their header. Every group starts
  collapsed and reopens collapsed: the state is deliberately not written to
  `data.json`, so closing settings or the app resets it.
- **Rebuilt on Obsidian's declarative settings API** (`getSettingDefinitions()`).
  Settings now appear in Obsidian's global settings search — typing "minimap"
  in the settings search finds them. This is why `minAppVersion` moves to
  **1.13.1**: the API does not exist before 1.13, and on 1.13+ the framework
  bypasses `display()` entirely, so there is no partial migration.
- The Mobile group is gone: both of its settings were promoted to the root page.

### Fixed

- Dragging the close-delay slider previously wrote to disk once per step; it is
  now debounced like every other slider.

### Unchanged on purpose

- All 27 setting keys keep their names, types and defaults. An existing
  `data.json` loads with no migration.
- The three settings the overlay reads live — close delay, smooth scroll and
  scroll-to-heading-on-hover — still persist without rebuilding the overlay.
- The heading-level sliders still push each other apart instead of inverting.
- Default tab still appears only in tabs mode.
- The active tab colour keeps its inline reset-to-theme button.

## 0.6.0-beta.1

### Added

- **Unified outline tree.** Headings, tasks, list items and callout headers now
  build one nested document-ordered tree instead of two parallel flat arrays.
  Sub-tasks sit under their parent task, and tasks sit under their heading.
  *Outline mode → Separate tabs* restores the previous two-tab UI.
- **Mobile support.** `isDesktopOnly` is now `false`. A button in the note
  header (`View.addAction`) opens the outline as a centred sheet with
  44px touch rows, a dismiss backdrop and a close button. The edge minimap is
  hidden on phones, where a ~16px strip is not a usable touch target.
- **Collapsible rows.** Fold a heading or task to hide what is nested under it.
- **Markdown-aware row text.** `## **Done** [[Project X|PX]] #tag` renders as
  “Done PX”. Resolves wikilinks and Markdown links, unwraps emphasis and inline
  code, and strips Tasks-plugin emoji metadata, Dataview inline fields,
  footnote references and block IDs. Optional, and tags are kept unless asked.
- **All task statuses.** `[x]`, `[/]`, `[-]`, `[>]`, `[?]`, `[!]` and unknown
  characters are recognised and individually toggleable, with their own glyphs.
  Only an unchecked task can still be completed from the popover.
- **Plain bullets and numbered items**, off by default: none / top level / all.
- **Callout headers** (`> [!note] Title`) as outline rows, off by default.
- Settings are grouped into Content, Appearance, Minimap, Behavior and Mobile.
- Unit tests (`npm test`) and a browser simulation harness (`npm run sim`)
  that runs the real overlay against a mock Obsidian API, plus `verify.mjs`
  which drives it with Playwright.

### Fixed

- **Folding no longer closes the popover.** The popover was vertically centred,
  so any height change moved both edges; folding a tall section slid it out
  from under the pointer and the resulting `pointerleave` dismissed it. The top
  edge is now pinned when the popover opens.
- **A list starting on line 0 no longer collapses into itself.**
  `ListItemCache.parent` encodes a root item as the negated line of the list's
  first item, and `-0 >= 0` is `true` in JavaScript, so every root item in such
  a list was read as a child of whatever sat on line 0.
- **Active-heading tracking is no longer O(n) per scroll frame.** It called
  `lineBlockAt` once per heading on every animation frame; it now binary
  searches, and guards against the metadata cache briefly leading the document.
- **Slider settings no longer write to disk and rebuild the overlay on every
  tick.** One sweep of a slider fired roughly sixteen of each; the writes are
  now debounced.
- **The outline no longer rebuilds its entire DOM on every edit.** Rows are
  reconciled by a stable `kind:line` key, so typing no longer destroys and
  recreates every element.
- Filtered views no longer inherit indentation from headings that are not on
  screen, which made the Tasks tab indent rows for no visible reason.
- Leaf rows no longer show a fold chevron in the mobile sheet.
- Active minimap markers use theme variables instead of hardcoded `#eee` and
  `#444`, which inverted on unusual light themes.
- `authorUrl` pointed at a misspelled, non-existent repository.
- `@codemirror/view` is imported directly but was only resolving transitively
  through `obsidian`; it is now a declared dependency.
- `package-lock.json` is no longer gitignored, so builds are reproducible.
- `completeTask` takes an explicit `app` rather than reaching through
  `view.app`.

### Notes

- Pointer events replace mouse events throughout, so touch no longer triggers
  hover-only paths. Hover-to-open is disabled on mobile, where there is no
  hover state.
- `minAppVersion` stays at `1.4.0`: `Vault.process` and `View.addAction` are
  both available since API 1.1.0.
