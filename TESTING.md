# Device test checklist — 0.7.2-beta.1

What I verified in the simulation harness, and what only a real device can tell
us. Everything in §1 is already automated (`node verify.mjs`, 48 assertions);
§2 is what I need you to try in your vault.

## Install into your vault

```bash
npm install
npm run build        # produces main.js
```

Copy `main.js`, `manifest.json` and `styles.css` into:

```
<vault>/.obsidian/plugins/subtle-toc/
```

Then reload Obsidian and enable **Subtle TOC**. For the phone, sync that folder
the way you normally sync your vault.

> **Requires Obsidian 1.13.0 or newer.** The settings tab is built on the
> declarative API added in 1.13, and Obsidian will refuse to load the plugin
> below that version. `0.6.0-beta.1` remains installable if you need to go back.

> **Your existing settings are preserved.** New options are added with defaults
> and nothing you had configured is reset. The one deliberate change is
> `Outline mode`, which now defaults to **Unified tree**. Setting it back to
> **Separate tabs** restores the previous Headings / Tasks UI exactly.

---

## 1. Already verified automatically

Run `node verify.mjs` with the harness served (see README) to re-check:

| Area | Assertions |
| --- | --- |
| Desktop layout | overlay positioning, popover hidden until opened, one dash per heading, hover opens |
| Outline data | 11 headings + 6 open tasks, only `[ ]` tasks by default, no bullets/callouts by default |
| Markdown | `**agenda**` → `agenda`, `[[A\|B]]` → `B`, `📅 2026-10-14` stripped, raw text when stripping off |
| Nesting | sub-task indents past its parent, H3 past H2, tasks tab does not inherit hidden heading indent |
| Folding | hides descendants, chevron survives collapse, unfolds again, leaf rows show no chevron |
| Navigation | clicking a row scrolls the note, active row tracked after scrolling |
| Statuses | all eight statuses render and carry their own class |
| Tabs mode | tab bar returns, Headings shows no tasks, Tasks shows only tasks |
| Phone | minimap hidden, exactly one header button, sheet opens fixed + wide, 44px rows, backdrop dismisses, row tap dismisses |
| Tablet | minimap kept, header button present |
| Header button | `never` adds none, `always` adds exactly one (no duplicates) |

Plus 46 unit tests (`npm test`) over the outline builder and Markdown stripping.

---

## 2. Please check on your devices

The harness mocks Obsidian, so these are the things it genuinely cannot prove.

### Desktop — regression (nothing should have changed)

- [ ] Hover the edge markers → popover opens as before; move away → it closes
- [ ] *Open the popover on → Click* still requires a click
- [ ] Active heading highlight follows scrolling in **Live Preview**, **Source**
      and **Reading** mode
- [ ] Clicking a heading scrolls and flashes the line, smooth scroll on and off
- [ ] *Scroll to heading on hover* previews and returns on leave
- [ ] Left side, popover width, minimap scales, active tab color all behave
- [ ] Turn on *Show task checkboxes* → ticking one completes it in the note and
      is undoable with Ctrl/Cmd+Z in editing mode
- [ ] Set *Outline mode → Separate tabs* → the old two-tab UI is back

### Desktop — new

- [ ] Fold a heading with the chevron; the popover **does not close** and does
      not jump (this was a real bug I hit and fixed — worth confirming)
- [ ] Unfold it again
- [ ] *List items → All* on a bullet-heavy note; check it is not overwhelming
- [ ] Turn on extra task statuses; confirm your `[/]`, `[-]`, `[>]` render
- [ ] A heading containing a link, bold text and a tag reads cleanly
- [ ] *Note header button → Always* adds one button, and switching notes
      repeatedly does **not** accumulate duplicates

### Phone — the main event

- [ ] The outline button appears in the note header
- [ ] Tapping it opens the sheet; rows are comfortable to hit
- [ ] Tapping outside closes it; the X closes it
- [ ] Tapping a row scrolls the note **and** dismisses the sheet
- [ ] The edge markers are gone (set *Hide minimap on phones* off to get them
      back if you want them)
- [ ] Nothing is clipped behind the keyboard or the system status bar
- [ ] Rotate to landscape — the sheet still fits

### Tablet

- [ ] Both the edge markers **and** the header button are available
- [ ] The sheet (not the desktop popover) is what opens

### Settings tab (new in 0.7.0-beta.1)

- [ ] Settings open on a short page of seven rows plus an **Advanced** entry
- [ ] Tapping **Advanced** opens a sub-page, and there is a way back
- [ ] The four groups read as **rows**, the same weight as the Advanced row —
      not as large bold section headings
- [ ] Each group row spans the **full width** of the settings pane
- [ ] The four group rows have a faint background tint distinguishing them
      from the settings inside them
- [ ] All four groups on it start **collapsed**
- [ ] Tapping a group header — not just the chevron — expands it, and the
      chevron flips
- [ ] Close settings and reopen: the groups are collapsed again
- [ ] Search Obsidian's settings for "minimap" and confirm Subtle TOC's rows
      are found, including ones inside collapsed groups
- [ ] Drag the popover width slider: the overlay updates once you stop, not on
      every step
- [ ] Set Outline mode to **Separate tabs**, then look in Advanced → Appearance:
      **Default tab** should now be there. Set it back to Unified and it goes
- [ ] Active tab colour still has its reset arrow, and the reset works
- [ ] Every setting you had before still has the value you left it on

### Known limitations (not fixed in this round — Phase 4/5 of `PLAN.md`)

- No keyboard navigation yet; rows are still not Tab-reachable
- Still one overlay for the focused pane only: split panes show it on the
  active pane, and it disappears when focus moves to a sidebar
- Task completion is still tracked by line number, so completing a task and
  then editing lines above it can briefly hide the wrong row
- Reading-mode flash still matches headings by text, so duplicate headings can
  flash the wrong one
