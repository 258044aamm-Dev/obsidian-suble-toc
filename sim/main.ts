import { installDomHelpers, App, Platform, setPlatform, TFile } from "./obsidian-mock";
import { MockEditorView } from "./cm-mock";
import { parseNote } from "./parse";
import { TocOverlay } from "../src/overlay";
import { SubtleTocSidebarView } from "../src/sidebar";
import { DEFAULT_SETTINGS, SubtleTocSettings } from "../src/types";

installDomHelpers();

const NOTE = `# Quarterly review

Opening paragraph that sets the scene for the rest of the document.

## Planning

- [ ] Draft the **agenda** for [[Leadership sync|the sync]]
	- [ ] Collect topics from each team
	- [x] Book the room
- [ ] Share pre-reading 📅 2026-10-14
- plain bullet that is not a task
- [/] Budget model in progress
- [-] Cancelled: offsite venue

### Dependencies

> [!warning] Blocked on finance
> The headcount numbers are not final.

1. First numbered item
2. Second numbered item

## Execution

Some prose in the execution section.

### Week one

- [ ] Kick-off call
- [ ] Publish the ~~old~~ new timeline

### Week two

- [ ] Mid-point check-in
- [>] Deferred: vendor review

## Risks

Content about risks goes here.

### Known unknowns

- [?] Will the vendor deliver on time
- [!] Headcount freeze is a hard blocker

## Appendix

### Glossary

### Changelog

A trailing paragraph so the last section can scroll to the top of the viewport.
`;

/** Pad the note so every heading can reach the top of the scroller. */
const PADDED = NOTE + "\n".repeat(40);

const noteLines = PADDED.split("\n");
const cache = parseNote(PADDED);

/* ---- render the fake note ------------------------------------------------ */

const contentEl = document.getElementById("note-content") as HTMLElement;
const scrollEl = document.getElementById("note-scroll") as HTMLElement;
const linesEl = document.getElementById("note-lines") as HTMLElement;

/** Paint one document line the way the harness shows it. */
function paintLine(el: HTMLElement, raw: string): void {
	el.className = "cm-line";
	const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
	if (heading) {
		el.classList.add("sim-heading", `sim-h${heading[1].length}`);
		el.textContent = raw;
	} else if (/^\s*>\s*\[!/.test(raw)) {
		el.classList.add("sim-callout");
		el.textContent = raw;
	} else if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(raw)) {
		el.classList.add("sim-list");
		el.textContent = raw;
	} else {
		el.textContent = raw || "\u00a0";
	}
}

const lineEls: HTMLElement[] = noteLines.map((raw) => {
	const el = document.createElement("div");
	paintLine(el, raw);
	linesEl.appendChild(el);
	return el;
});

const cm = new MockEditorView(scrollEl, lineEls);

/* ---- fake plugin + view -------------------------------------------------- */

const app = new App();
app.metadataCache.cache = cache;

const file = new TFile("Quarterly review.md");

const headerActionsEl = document.getElementById("header-actions") as HTMLElement;

/**
 * Re-parse and hand the new cache over, as Obsidian does — *after a beat*, not
 * inside the edit. The delay is the whole reason the renderer keeps a
 * completed-task bridge: for those ~150ms the file says `[x]` while the cache
 * still says `[ ]`, and a list that trusted only the cache would either drop
 * the row instantly or resurrect it.
 */
function reparse(): void {
	window.setTimeout(() => {
		app.metadataCache.cache = parseNote(noteLines.join("\n"));
		app.metadataCache.trigger("changed", file);
	}, 150);
}

const editor = {
	cm,
	getLine: (n: number) => noteLines[n] ?? "",
	lineCount: () => noteLines.length,
	replaceRange(
		text: string,
		from: { line: number; ch: number },
		to?: { line: number; ch: number },
	) {
		const line = noteLines[from.line] ?? "";
		const endCh = to?.ch ?? from.ch;
		noteLines[from.line] = line.slice(0, from.ch) + text + line.slice(endCh);
		paintLine(lineEls[from.line], noteLines[from.line]);
		reparse();
	},
	setValue(value: string) {
		noteLines.length = 0;
		noteLines.push(...value.split("\n"));
	},
};

const view = {
	app,
	file,
	contentEl,
	editor,
	currentMode: {},
	getMode: () => "source",
	getViewData: () => noteLines.join("\n"),
	addAction(_icon: string, title: string, callback: () => void) {
		const btn = document.createElement("div");
		btn.className = "view-action";
		btn.title = title;
		btn.setAttribute("aria-label", title);
		btn.innerHTML =
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
			'stroke-linecap="round" stroke-linejoin="round" width="18" height="18">' +
			'<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/>' +
			'<path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>';
		btn.addEventListener("click", callback);
		headerActionsEl.appendChild(btn);
		return btn;
	},
} as any;

const settings: SubtleTocSettings = { ...DEFAULT_SETTINGS };

const plugin = {
	app,
	settings,
	/** What main.ts keeps for the sidebar: the last note view it saw. */
	noteView: view,
} as any;

let overlay: TocOverlay | null = null;
let sidebar: SubtleTocSidebarView | null = null;

const dockEl = document.getElementById("dock") as HTMLElement;
const dockBodyEl = document.getElementById("dock-body") as HTMLElement;

/**
 * The sidebar view, driven exactly the way Obsidian drives it: construct with a
 * leaf, hand it a container, call onOpen(). `noteView` is what the plugin's
 * tracker supplies — the panel never asks the workspace for the active note,
 * because when it has focus that answer is null.
 */
function rebuildSidebar(): void {
	sidebar?.unload();
	dockBodyEl.empty();
	sidebar = new SubtleTocSidebarView({ app } as never, plugin);
	sidebar.onOpen();
	dockBodyEl.appendChild(sidebar.containerEl);
	sidebar.refresh();
	report();
}

function rebuild(): void {
	overlay?.unmount();
	overlay = new TocOverlay(plugin, view);
	overlay.mount();
	overlay.refresh();
	rebuildSidebar();
}

/* ---- controls ------------------------------------------------------------ */

const frameEl = document.getElementById("frame") as HTMLElement;

function setDevice(profile: "desktop" | "tablet" | "phone"): void {
	setPlatform(profile);
	frameEl.className = `frame is-${profile}`;
	rebuild();
}

function bindSelect(id: string, apply: (value: string) => void): void {
	const el = document.getElementById(id) as HTMLSelectElement | null;
	if (!el) return;
	el.addEventListener("change", () => {
		apply(el.value);
		rebuild();
	});
}

function bindCheck(id: string, apply: (value: boolean) => void): void {
	const el = document.getElementById(id) as HTMLInputElement | null;
	if (!el) return;
	el.addEventListener("change", () => {
		apply(el.checked);
		rebuild();
	});
}

bindSelect("device", (v) => setDevice(v as "desktop" | "tablet" | "phone"));
bindSelect("outlineMode", (v) => (settings.outlineMode = v as SubtleTocSettings["outlineMode"]));
bindSelect("listItems", (v) => (settings.listItems = v as SubtleTocSettings["listItems"]));
bindSelect("show", (v) => (settings.show = v as SubtleTocSettings["show"]));
bindSelect("side", (v) => (settings.side = v as SubtleTocSettings["side"]));
bindSelect("headerButton", (v) => (settings.headerButton = v as SubtleTocSettings["headerButton"]));
bindCheck("stripMarkdown", (v) => (settings.stripMarkdown = v));
bindCheck("stripTags", (v) => (settings.stripTags = v));
bindCheck("showCallouts", (v) => (settings.showCallouts = v));
bindCheck("collapsible", (v) => (settings.collapsible = v));
bindCheck("showTaskCheckboxes", (v) => (settings.showTaskCheckboxes = v));
bindCheck("multiLine", (v) => (settings.multiLine = v));
bindCheck("allStatuses", (v) => {
	settings.taskStatuses = v
		? ["todo", "inProgress", "done", "forwarded", "important", "question", "cancelled", "other"]
		: ["todo"];
});

document.getElementById("open")?.addEventListener("click", () => overlay?.open());
document.getElementById("close")?.addEventListener("click", () => overlay?.close());

/* ---- readout ------------------------------------------------------------- */

function report(): void {
	const out = document.getElementById("readout");
	if (!out) return;
	const root = contentEl.querySelector(".subtle-toc-root");
	const rows = root?.querySelectorAll(".subtle-toc-item") ?? [];
	const dashes = root?.querySelectorAll(".subtle-toc-dash") ?? [];
	const kinds: Record<string, number> = {};
	rows.forEach((r) => {
		for (const c of Array.from(r.classList)) {
			if (c.startsWith("subtle-toc-kind-")) {
				const k = c.replace("subtle-toc-kind-", "");
				kinds[k] = (kinds[k] ?? 0) + 1;
			}
		}
	});
	const sideRows = dockBodyEl.querySelectorAll(".subtle-toc-item").length;
	const parts = Object.entries(kinds).map(([k, n]) => `${k}: ${n}`);
	out.textContent =
		`platform: ${Platform.isPhone ? "phone" : Platform.isTablet ? "tablet" : "desktop"} · ` +
		`rows: ${rows.length} · dashes: ${dashes.length} · sidebar rows: ${sideRows}` +
		(parts.length ? ` · ${parts.join(", ")}` : "");
}

// Re-read the counts after interactions so the readout tracks folds and taps.
contentEl.addEventListener("click", () => window.setTimeout(report, 50));

setDevice("desktop");
report();

// Expose for console poking during development.
/**
 * Point the two surfaces at a different note, the way switching files would.
 * "none" is the drawer-has-focus case: no note view at all.
 */
function setNoteView(mode: "note" | "none" | "prose"): void {
	if (mode === "note") {
		plugin.noteView = view;
		app.metadataCache.cache = cache;
	} else if (mode === "none") {
		plugin.noteView = null;
	} else {
		plugin.noteView = {
			...view,
			file: new TFile("Empty note.md"),
			getViewData: () => "Just a paragraph, no headings and no tasks.\n",
		};
		app.metadataCache.cache = parseNote("Just a paragraph, no headings and no tasks.\n");
	}
	rebuildSidebar();
	report();
}

(window as any).sim = {
	overlay: () => overlay,
	sidebar: () => sidebar,
	plugin: () => plugin,
	settings,
	rebuild,
	setDevice,
	setNoteView,
	report,
};
