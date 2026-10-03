# Subtle TOC

A floating, Capacities-style table of contents for [Obsidian](https://obsidian.md).

A discreet dashed **minimap** lives on the edge of your note. Hover (or click) it
and a **popover outline** slides out — the heading for the section you're reading
is highlighted, and clicking any heading jumps to it. On mobile, a button in the
note header opens the same outline as a sheet.

The outline is a single nested tree: headings, open tasks, and optionally plain
list items and callout headers, each sitting under the heading it belongs to.

## Features

- **Floating popover** overlaid on the note (no sidebar pane needed).
- **Unified outline tree** — headings, tasks, lists and callouts in one nested
  view, with sub-tasks under their parent task. The original two-tab split is
  still available via *Outline mode → Separate tabs*.
- **Mobile support** — a button in the note header opens the outline as a
  full-size sheet with touch-sized rows, a backdrop, and a close button.
- **Collapsible rows** — fold a heading or a task to hide everything under it.
- **Readable row text** — `## **Done** [[Project X|PX]]` shows as “Done PX”
  instead of raw Markdown. Tasks-plugin dates and Dataview inline fields are
  stripped too.
- **All task statuses** — not just `[ ]`. Choose which of to-do, in progress,
  done, forwarded, important, question and cancelled appear.
- **Bullets and numbered lists** *(optional)* — off by default, since a long
  note can produce a lot of rows.
- **Callout headers** *(optional)* — `> [!note] Title` as an outline row.
- **Edge minimap** of dashes, one per heading, sized by heading level.
- **Active-heading tracking** in both Editing (Live Preview / Source) and Reading mode.
- **Click to navigate** with optional smooth scroll — works in both modes.
- **Preview headings on hover** *(optional)* — moving across heading rows in the
  popover temporarily scrolls the note without moving the editor cursor. Leaving
  returns to the previous position; clicking stays at the heading.
- **Tasks tab** — the note's open tasks (unchecked checkboxes), in document order,
  as a second tab in the popover, with a live open-task count on the tab.
- **Edge task badge** — a checkbox + count on the edge whenever the note has open
  tasks (below the dashes, or on its own when the note has no headings).
- **Complete from the TOC** *(optional)* — turn on task checkboxes to tick a task
  straight from the popover; it's marked done in the note (undoable in Editing
  mode), strikes through, and drops out the next time you open the popover.
- **Show** what you want: headings, tasks, or both.
- **Multi-line rows** so long headings and tasks are readable in full — or turn
  them off for single-line rows with the full text in a tooltip.
- **Tweakable feel**: which tab leads the popover, how long it waits before
  closing, the color of the selected tab, and whether the edge shows the task
  badge. Leaving the popover sideways, back toward the note, always closes it at
  once.
- Configurable side (left/right), open trigger (hover/click) and heading-level
  range. The heading-level range doesn't apply to tasks.

## Settings

Settings open on a short page of the seven you are most likely to want. The
rest live behind a single **Advanced** entry, on a sub-page of collapsible
groups that start closed.

### Basic

| Setting | Default | What it does |
| --- | --- | --- |
| Show | Both | Surface headings, tasks, or both. |
| Outline mode | Unified tree | One nested tree, or the original separate Headings / Tasks tabs. |
| Side | Right | Which edge of the note to dock on. |
| Open the popover on | Hover | Hover the minimap, or require a click. |
| Show minimap | On | The dashed markers along the edge. |
| Note header button | On mobile only | Adds a button to the note header that opens the outline. |
| Hide minimap on phones | On | Hide the edge markers on phone-sized screens, where they are too narrow to tap. |

### Advanced

Reached from the **Advanced** entry at the bottom of the settings page. The rest
of the settings are grouped into four collapsible rows — **Content**,
**Appearance**, **Minimap** and **Behavior** — each with a one-line description
and a caret on the right-hand side that folds its settings away.

**Content**

| Setting | Default | What it does |
| --- | --- | --- |
| List items | None | Include plain bullets and numbered items: none, top level only, or all. |
| Callouts | Off | Include callout headers as outline rows. |
| Task statuses | To do | Which checkbox statuses appear. Only an unchecked task can be completed from the popover. |
| Minimum / maximum heading level | 1 / 6 | Heading levels to include (tasks are unaffected). |

**Appearance**

| Setting | Default | What it does |
| --- | --- | --- |
| Clean up Markdown | On | Resolve links and strip formatting marks in row text. |
| Hide tags | Off | Also remove tags from the displayed text. |
| Show multiple lines | On | Wrap long rows; when off, rows are single-line and hovering shows the full text. |
| Show task checkboxes | Off | Add a checkbox to each task row to complete it from the popover. |
| Collapsible rows | On | Allow folding a row to hide the rows nested under it. |
| Popover width | 264 px | Set the TOC popover width from 160 to 480 pixels. |
| Active tab color | *theme* | Background of the selected tab. Reset it to follow the theme. |
| Default tab | Headings | *(Separate tabs mode only.)* Tab that leads the tab bar and opens first. |

**Minimap**

| Setting | Default | What it does |
| --- | --- | --- |
| Minimap marker width | 100% | Scale marker length from 50% to 200%; above 100%, higher-level headings grow progressively more. |
| Minimap vertical scale | 100% | Scale marker thickness and spacing from 50% to 200%. |
| Show tasks in minimap | On | The open-task badge on the edge. Notes with tasks but no headings always show it. |

**Behavior**

| Setting | Default | What it does |
| --- | --- | --- |
| Close delay | 160 ms | Grace period before the popover closes once the mouse leaves it. |
| Smooth scroll | On | Animate the scroll when navigating. |
| Scroll to heading on hover | Off | Temporarily scroll to a hovered heading and return on leave; click to navigate normally and stay there. |

## Develop and verify

```bash
npm install
npm run dev     # esbuild watch -> rebuilds main.js on change
npm test        # unit tests: outline tree, Markdown stripping, settings
npm run sim     # build the browser simulation harness
```

The **simulation harness** in `sim/` bundles the real `src/` modules against a
mock Obsidian API, so the overlay can be driven in a plain browser — including
the phone and tablet layouts, which are otherwise awkward to iterate on:

```bash
npm run sim
npx http-server sim -p 8080 -c-1   # then open http://127.0.0.1:8080
```

`npm run verify` drives that harness with Playwright and asserts the behaviour
unit tests cannot reach: layout, pointer interaction, the mobile sheet, folding
and navigation. See `TESTING.md` for what it covers and what still needs a real
device.

## Screenshots

![Suble TOC](subtle-toc-obsidian_tasks.png)

## Install (Community plugins)

1. Open *Settings → Community plugins* in Obsidian.
2. Make sure **Restricted mode** is turned off (click **Turn on community plugins** if needed).
3. Click **Browse**, search for **Subtle TOC**, and open its page.
4. Click **Install**, then **Enable**.

## Install (BRAT — beta / before it's in the directory)

If the plugin isn't in the official Community plugins directory yet, you can
install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install **BRAT** from *Settings → Community plugins → Browse* and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Paste the repository URL:
   ```
   https://github.com/xupisco/obisidian-suble-toc
   ```
4. Confirm — BRAT downloads the latest release and keeps it up to date.
5. Enable **Subtle TOC** in *Settings → Community plugins*.

## Install (manual / for development)

1. Build the plugin:
   ```bash
   npm install
   npm run build      # produces main.js
   ```
2. Copy `main.js`, `manifest.json` and `styles.css` into your vault at:
   ```
   <vault>/.obsidian/plugins/subtle-toc/
   ```
3. Reload Obsidian and enable **Subtle TOC** in *Settings → Community plugins*.

## Develop

```bash
npm install
npm run dev          # esbuild watch -> rebuilds main.js on change
```

Point the output at a test vault by symlinking the plugin folder, or copy the
three files after each build. Use the "Toggle TOC popover" command (assign a
hotkey) to open/close the outline from the keyboard.

## How it works

- Headings and tasks both come from Obsidian's `metadataCache`, so the outline
  stays in sync as you type. Tasks are the open list items (`- [ ]`) of the active
  note only.
- Active-heading detection uses CodeMirror 6 line geometry in Editing mode and
  the preview scroll position in Reading mode. Clicking a task navigates to it the
  same way headings do.
- Completing a task edits the note through the editor in Editing mode (so it's
  undoable) and writes the file directly in Reading mode.
- One overlay instance is bound to the active Markdown view at a time and rebuilt
  when you switch notes, panes or modes.

## License

MIT
