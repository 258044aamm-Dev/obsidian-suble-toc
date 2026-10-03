# Changelog

## 0.8.0-beta.1

The outline can now live in Obsidian's own side panel — the panel the swipe
opens on a phone, the right dock on desktop — while the floating popover stays
exactly as it was. Both can be on at once.

### Added

- **Sidebar view.** A standalone `SubtleTOC` view, beside Obsidian's Backlinks
  and Outline tabs rather than replacing them. It renders through the *same*
  renderer as the popover, so everything the popover can show, it shows:
  headings, tasks, plain list items, callouts, folding, task checkboxes, task
  statuses, multi-line wrapping, the heading-level range, click-to-scroll and
  active-row tracking. What it does not carry is the popover's chrome and its
  scroll-on-hover preview, neither of which means anything in a panel you are
  reading from.
- **Two commands**: *Open in sidebar* (`ensureSideLeaf` with a reveal) and
  *Toggle sidebar view* (reveals, or puts the dock away when the panel is
  already the focused one).
- **Three settings**, all under *Advanced → Behavior*:
  - **Sidebar outline** — `off` (the default: the view is registered and open
    from its tab or the command, the plugin just never places it), `armed`
    (the panel becomes the dock's active tab at startup *without* opening,
    which is what makes Obsidian's own swipe land on it), or `open` (same, and
    reveals the dock at startup).
  - **Sidebar side** — which dock the panel lives in, right by default.
  - **Close the drawer after a row** — phones only, on by default: tapping a
    row scrolls the note and collapses the drawer, so the heading you just
    jumped to is not left behind the panel.

### Changed

- **`TocOverlay` was split**: the outline itself — rows, tabs, folding,
  completion, active tracking — moved into a new `OutlineTreeRenderer`
  (`src/tree.ts`), and the inline SVG icons into `src/icons.ts`. The overlay
  keeps the edge, minimap, task badge, popover/sheet chrome and the note-header
  button. This is a move, not a rewrite: the overlay's DOM, class names and
  behaviour are unchanged, verified by the pre-existing suite running green
  without a single assertion edited.

### Notes

- The note-header button is **unchanged** — it still toggles the popover.
  Repointing an existing affordance at something new is a surprise, not a
  feature; the panel has its own tab and its own commands.
- The sidebar tracks the last note view it saw, because with the panel focused
  `getActiveViewOfType(MarkdownView)` answers `null` — the naive version of this
  is empty exactly when you tap into it.
- Nothing changes for anyone who does not opt in: `sidebarMode` ships `off`,
  and the view is inert until it is placed.

### Testing

- 86 unit tests (74 before) and 518 browser assertions (479 before), build
  clean.
- The harness grew a plugin-level page that boots the *real* plugin against the
  mock workspace (registration, layout-ready placement, the commands, the
  note-header button), so the placement assertions test the real startup path
  rather than a helper called by hand.
- Sensitivity, as usual: forcing `reveal: true` fails the two `armed`
  assertions; dropping the phone guard on the drawer collapse fails the desktop
  "leaves the dock alone" assertion; breaking the shared renderer's active-row
  marker fails the popover assertion *and* the panel assertion.

## 0.7.5-beta.1

Removes dead code and stale references. No behaviour change, no settings UI
change, no overlay change — the plugin does exactly what 0.7.4 did.

### Removed

- **`isFoldable()`** (`src/outline.ts`) — referenced nowhere; folding is done in
  `overlay.ts`. A leftover from the 0.6.0 outline refactor.
- **`HeadingItem`, `TaskItem`** (`src/types.ts`) — the pre-0.6.0 outline shapes,
  replaced by `OutlineNode`.
- **`listMaxDepth`** — a setting nothing read: not the plugin, not the settings
  UI, not the tests (which excluded it by name as a known gap). It was still
  written into every user's `data.json` and advertised depth limiting that does
  not exist. Existing data files keep a harmless orphan key. Implementing depth
  limiting would be a feature, not a cleanup; if it is wanted, the key comes
  back with the feature.
- **`sim/settings-mockup.html`** — a 290-line design mockup nothing referenced.
- **`IconName`, and three unused stub classes** in the harness/test stubs.
- **A dead harness CSS rule** (`.frame.is-tablet` — no code applies the class),
  an unused `addAction(icon, …)` parameter in the harness, and the **`tslib`**
  devDependency (no file imports it; the build only type-checks and lets esbuild
  inline its own helpers).
- Seven types that were exported but used only inside their own file now stay
  private: the compiler then guards them for free.

### Fixed

- `README.md` pointed BRAT at `xupisco/obisidian-suble-toc` — the upstream repo
  (not a fork's build), with a typo that only worked because GitHub
  case-corrects it. The URL is now upstream's canonical one, with a line telling
  fork testers to paste their own URL.
- `TESTING.md` cited "Phase 4/5 of `PLAN.md`", a file that is not in the
  repository.

### Added

- `tests/hygiene.test.ts`, two guards against the ways dead code accumulated
  here. Both are deliberate about being conservative and both fail loudly if
  their own scan breaks:
  - **No stylesheet ships a class the plugin cannot produce.** Collects the
    `subtle-toc-*` classes styled in `styles.css` and the ones `src/` can emit —
    literals plus the prefixes behind template-built names like
    `subtle-toc-level-${level}` — parsing with TypeScript rather than pattern
    matching. Prefixes keep the guard from needing an edit every time a status
    is added, and the parser keeps it honest: the two hand-rolled earlier
    attempts (a regex, then a scanner) both found *nothing* and passed.
  - **No module exports something nothing imports.** `tsc --noUnusedLocals`
    cannot see this — the compiler takes an `export` as evidence of a consumer —
    which is how an unused function and two dead interfaces sat in `src/`. There
    is an `ALLOWED_UNUSED` map with a reason per entry, and a companion test that
    fails if an allow-listed symbol stops being exported.

### Testing

- 74 unit tests (71 before), 479 browser assertions, build clean.
- Each new guard was verified to fail when it should: a stylesheet rule for a
  class nothing emits, and a re-added unreferenced export, each produce a failing
  test naming the offending symbol.
- `tsc --noUnusedLocals --noUnusedParameters` is now silent across `src/` **and**
  the harness, which it was not before.

## 0.7.4-beta.1

Puts the caret on the right-hand side of the Advanced page's group rows, and
gives each group the one-line description it was missing. Settings UI only — no
outline, overlay, behaviour or default changed.

### Fixed

- **The caret sat under the group title**, flush left, with a tall band of dead
  space beneath it — on desktop *and* on a phone. This is the fourth fix for
  that symptom, and the first one that removes its cause instead of arguing with
  it. A settings row is laid out by Obsidian, and the two slots it offers for
  content (`infoEl`, `controlEl`) are siblings of each other: whatever the host
  does to lay the row out decides where the caret lands. Restating the row's own
  `flex-direction` could only ever out-argue one of those layouts, on one
  platform, until the next stylesheet change — which is why 0.7.1, 0.7.2 and
  0.7.3 each shipped a fix a device could still contradict.

### Changed

- **The row's interior is ours now.** The header row carries a single child —
  title, description, then the caret — and lays that child out itself. The host
  has one box to place, so no direction it stacks in can separate the title from
  the caret. Core's own name/desc/control boxes stay in the DOM (the framework
  pokes at them on re-render) but are taken out of the layout, scoped to this
  row's class, so no other settings row — this plugin's, Obsidian's or another
  plugin's — is touched.
- **Each group describes itself in one line**, drawn under its title: Content,
  Appearance, Minimap, Behavior. The same line is mirrored into the definition's
  `desc` so the row and the definition cannot drift apart, which
  `tests/settings.test.ts` asserts.

### Unchanged

Groups still start collapsed, still toggle independently, still reset when the
settings window closes, still degrade to open when no list element is handed
over, and still keep out of settings search. The caret is still Obsidian's own
extra button — only its position is ours — so clicking it toggles once rather
than twice, the row remains the click target, Enter and Space still work, and
every setting keeps its key, type and default. No overlay rule changed.

### Testing

Three releases shipped a caret that was wrong on the user's screen while the
suite stayed green, so the suite is the more important half of this change.

- **The harness no longer models Obsidian's row.** `sim/settings-probe.html`
  declared `.setting-item { display: flex }` itself and the probe put the
  chevron into `controlEl` with its own hands, so the row layout the plugin
  depends on was an assumption *encoded as a fixture* — and no assertion could
  fail while that assumption held. Five shapes are now asserted against: the
  header inside the group's list element, beside it, and inside a plain block, a
  row-direction and a column-direction wrapper. In the last three the row is
  given **no layout at all**, so the plugin's row has to stand on its own in
  every direction.
- **A negative control that has to fail.** The two-slot row — title in one box,
  chevron in the next, stacked — is rendered with no plugin markup in play, and
  the geometry check is asserted to *fail* against it. A fixture that cannot see
  the defect is not a fixture.
- **Geometry, not properties.** The caret must sit right of the title, at the
  row's own right-hand edge (measured against the row's content box, not the
  title's width), level with the text block, last in the row — and the row must
  be one line tall rather than three stacked. Titles, descriptions and carets
  are counted, and an ordinary settings row is checked to still show its own
  name.
- Taking the row's layout away reproduces the defect in the harness: 90 failing
  assertions, on both fixtures. 479 browser assertions across fixture × shape,
  71 unit tests.

## 0.7.3-beta.1

Fixes the caret position on the Advanced page's group rows. CSS only — no
TypeScript changed, no behaviour changed, no default changed.

### Fixed

- **The caret sat below the group title instead of beside it**, flush left,
  leaving a tall band of dead space in each row. Obsidian's mobile stylesheet
  lays a settings row out as a column — name on top, control beneath — and only
  switches back to a horizontal row for rows carrying a control modifier class
  (toggle, dropdown, slider). A group header is a `render` definition with no
  control, so it got no modifier class and fell through to the stacked default.
  The row layout is now stated explicitly instead of inherited.

  Every rule is scoped to `.subtle-toc-settings-group-header` and compounded
  with `.setting-item`, so it outranks Obsidian's mobile rule on specificity
  without `!important` and cannot match any other settings row — this plugin's,
  Obsidian's, or another plugin's.

### Testing

The harness could not previously observe this bug: `sim/settings-probe.html`
**declared** `.setting-item { display: flex }` itself, so a stacked row was
impossible by construction. The assumption had been encoded as a test fixture,
which is why 90 green assertions and a screenshot review all missed it.

- That rule is replaced by two fixtures, a desktop row and a mobile row that
  stacks, derived from a device screenshot and labelled as an approximation.
- The whole settings suite now runs across **fixture × shape** — desktop and
  mobile, in a phone viewport, against both plausible group structures.
- Three geometric assertions per group that cannot pass while the caret is
  stacked: the caret is right of the title, shares its line to within 2px, and
  the row's content is shorter than title + caret stacked (no magic threshold,
  so it holds on both platforms).
- Removing the fix reproduces the reported defect in the harness —
  `caretLeft=40 titleRight=96`, `caretMidY=91 titleMidY=49`, row height 109px —
  and desktop stays clean. 160 browser assertions, 69 unit tests.

## 0.7.2-beta.1

Fixes the width of the group rows on the Advanced page. Settings UI only — no
change to the outline, the overlay, the basic page, or any default.

### Fixed

- **Group rows rendered at a fraction of the pane width.** Every settings group
  was given the class `subtle-toc-group`, which the *overlay* already owns: it
  is the flex row that holds the minimap and the popover against the edge of a
  note (`styles.css:32`, `display: flex; align-items: center; gap: 8px`). The
  settings tab silently inherited that layout, so each group shrank to the
  width of its longest label instead of filling the pane. Every settings class
  is now namespaced `subtle-toc-settings-`, and the header states its own width
  rather than trusting a container Obsidian owns.

### Added

- A background tint on the four group headers, from `--background-secondary`,
  so they read as dividers between the settings rather than as more settings.
  Being a theme variable it follows light/dark and any installed theme.
- A regression guard: `tests/settings.test.ts` asserts the set of class names
  `settings.ts` emits never intersects those from `overlay.ts`/`dom.ts`. This
  is the test that would have caught the bug in 0.7.0 — neither the type system
  nor the stylesheet can see a collision like it.

### Unchanged

Groups still start collapsed, still toggle independently with several open at
once, and still reset when the settings window closes without ever being
written to `data.json`. All 27 setting keys keep their names, types and
defaults. The overlay keeps `subtle-toc-group` and none of its rules changed.

### Testing

- The browser probe now renders **both** plausible structures for Obsidian's
  group markup — header inside the list element, and header as a sibling of it
  — and runs every assertion against each, because the real markup belongs to
  Obsidian and the harness cannot observe it.
- Width is measured against the container's content box rather than read off a
  CSS property, since the defect came from an inherited `display: flex` on an
  ancestor that no property on the row itself would reveal.
- 90 browser assertions and 69 unit tests. Restoring the collision fails 10 of
  them; restoring the class name fails the guard.

## 0.7.1-beta.1

Fixes the Advanced page's group headers. Settings UI only — no change to the
outline, the overlay, the basic page, or any default.

### Fixed

- **Group headers rendered as section headings instead of rows.** Content,
  Appearance, Minimap and Behavior used the group's `heading` field, which is
  Obsidian's section-divider primitive: larger, bolder and heavily spaced. The
  Advanced page read as four stacked titles rather than a list of rows. Each
  header is now an ordinary `.setting-item`, the same markup Obsidian gives the
  *Advanced* navigation entry, so it matches that weight without overriding any
  theme styling.

### Changed

- Collapsing is now scoped to the list element Obsidian hands us rather than
  guessing which ancestor is the group root. `wireCollapse()` previously walked
  up the DOM from the chevron to find the header; a `render` definition is
  passed both the row and the list element directly, so that walk — and its
  failure mode — is gone.
- The whole header row is the click target, with `role="button"`,
  `aria-expanded` and `aria-controls`, and a 44px minimum height on mobile.

### Unchanged

Groups still start collapsed, still toggle independently with several open at
once, and still reset to collapsed when the settings window closes without ever
being written to `data.json`. All 27 setting keys keep their names, types and
defaults.

### Testing

- New browser probe (`sim/settings-probe.html`) exercises the real collapse
  code against real DOM and the real stylesheet: 15 assertions covering the
  header being a row, collapsed-on-arrival, clicking the row, clicking the
  chevron toggling once rather than twice, keyboard activation, independence
  between groups, reset on close, and the no-list-element degradation.
- A static mockup (`sim/settings-mockup.html`) shows the heading-versus-row
  comparison side by side.
- 63 browser assertions and 68 unit tests, all mutation-checked.

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
  **1.13.0**: the API does not exist before 1.13, and on 1.13+ the framework
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
