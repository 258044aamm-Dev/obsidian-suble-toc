/**
 * Plugin-level harness: the *real* `SubtleTocPlugin` against the mock
 * workspace, so the parts that only exist at that level get exercised —
 * view registration, the startup placement (`sidebarMode`), the two commands,
 * the last-note-view tracker, and the drawer collapse on a phone.
 *
 * The overlay harness (`index.html`) mounts the surfaces directly; this page
 * goes through the front door and lets the plugin place them itself.
 */
import {
	installDomHelpers,
	App,
	MarkdownView,
	Platform,
	setPlatform,
	TFile,
} from "./obsidian-mock";
import { MockEditorView } from "./cm-mock";
import { parseNote } from "./parse";
import SubtleTocPlugin from "../src/main";
import { VIEW_TYPE_SUBTLE_TOC, openSidebar, toggleSidebar } from "../src/sidebar-mode";
import { DEFAULT_SETTINGS, SubtleTocSettings } from "../src/types";

installDomHelpers();

const NOTE = `# Quarterly review

Opening paragraph that sets the scene.

## Planning

- [ ] Draft the agenda
	- [ ] Collect topics
- [ ] Share pre-reading

### Dependencies

## Execution

- [ ] Kick-off call

## Risks

- [ ] Will the vendor deliver on time
`;

/** Padded, so a heading near the end has somewhere to scroll to. */
const PADDED = NOTE + "\n".repeat(40);
const noteLines = PADDED.split("\n");
const cache = parseNote(PADDED);

/* ---- the note the plugin manages ----------------------------------------- */

const contentEl = document.getElementById("note-content") as HTMLElement;
const scrollEl = document.getElementById("note-scroll") as HTMLElement;
const linesEl = document.getElementById("note-lines") as HTMLElement;

const lineEls: HTMLElement[] = noteLines.map((raw) => {
	const el = document.createElement("div");
	el.className = "cm-line";
	el.textContent = raw || "\u00a0";
	linesEl.appendChild(el);
	return el;
});

const cm = new MockEditorView(scrollEl, lineEls);
const app = new App();
app.metadataCache.cache = cache;

const file = new TFile("Quarterly review.md");
const headerActionsEl = document.getElementById("header-actions") as HTMLElement;

/**
 * A MarkdownView as far as `instanceof` is concerned, because that is exactly
 * what main.ts asks the workspace for when deciding whether there is a note to
 * outline at all.
 */
const view = Object.assign(Object.create(MarkdownView.prototype), {
	app,
	file,
	contentEl,
	editor: { cm, getLine: (n: number) => noteLines[n] ?? "" },
	currentMode: {},
	getMode: () => "source",
	getViewData: () => PADDED,
	addAction(_icon: string, title: string, callback: () => void) {
		const btn = document.createElement("div");
		btn.className = "view-action";
		btn.title = title;
		btn.setAttribute("aria-label", title);
		btn.addEventListener("click", callback);
		headerActionsEl.appendChild(btn);
		return btn;
	},
});

app.workspace.setActiveView(view as never, null);
app.workspace.sideHosts = {
	right: document.getElementById("dock-body-right") as HTMLElement,
	left: document.getElementById("dock-body-left") as HTMLElement,
};

/* ---- settings ------------------------------------------------------------ */

/**
 * The harness's stand-in for data.json: what `loadData` hands the plugin.
 * Persisted in localStorage, so a reload genuinely boots with the mode the
 * driver picked — placement happens once, at layout-ready, and that is the
 * only way to observe `off` / `armed` / `open` for real rather than by calling
 * the placement helper by hand.
 */
const STORE_KEY = "subtle-toc-sim-settings";
const persisted = (): Partial<SubtleTocSettings> => {
	try {
		return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}");
	} catch {
		return {};
	}
};
const storedSettings: SubtleTocSettings = {
	...DEFAULT_SETTINGS,
	sidebarMode: "armed",
	...persisted(),
};

const plugin = new SubtleTocPlugin(app as never, { id: "subtle-toc", version: "0.0.0" } as never);
(plugin as unknown as { loadData: () => Promise<unknown> }).loadData = async () => storedSettings;

/** The plugin's own settings object, which is where it reads them from. */
const settings = () => (plugin as unknown as { settings: SubtleTocSettings }).settings;

/** The placement controls, as the user has them set. */
function controlValues(): Pick<
	SubtleTocSettings,
	"sidebarMode" | "sidebarSide" | "sidebarCollapseOnTap"
> {
	return {
		sidebarMode: (document.getElementById("sidebarMode") as HTMLSelectElement)
			.value as SubtleTocSettings["sidebarMode"],
		sidebarSide: (document.getElementById("sidebarSide") as HTMLSelectElement)
			.value as SubtleTocSettings["sidebarSide"],
		sidebarCollapseOnTap: (
			document.getElementById("sidebarCollapseOnTap") as HTMLInputElement
		).checked,
	};
}

/** Show the stored values in the controls, so a reload is legible. */
function paintControls(values: SubtleTocSettings): void {
	(document.getElementById("sidebarMode") as HTMLSelectElement).value = values.sidebarMode;
	(document.getElementById("sidebarSide") as HTMLSelectElement).value = values.sidebarSide;
	(document.getElementById("sidebarCollapseOnTap") as HTMLInputElement).checked =
		values.sidebarCollapseOnTap;
}

/** The controls are what the settings tab writes; persist them as it does. */
function applyControls(): void {
	const values = controlValues();
	Object.assign(settings(), values);
	localStorage.setItem(STORE_KEY, JSON.stringify(values));
}

/* ---- readout ------------------------------------------------------------- */

function report(): void {
	const out = document.getElementById("readout");
	if (!out) return;
	const s = settings();
	const panelRows = document.querySelectorAll(".subtle-toc-sidebar .subtle-toc-item").length;
	const placed = app.workspace.getLeavesOfType(VIEW_TYPE_SUBTLE_TOC).length > 0;
	out.textContent =
		`platform: ${Platform.isMobile ? (Platform.isPhone ? "phone" : "tablet") : "desktop"} · ` +
		`mode: ${s.sidebarMode} · side: ${s.sidebarSide} · panel: ${placed ? "placed" : "—"} · ` +
		`rows: ${panelRows} · docks: left ${app.workspace.leftSplit.collapsed ? "collapsed" : "open"}, ` +
		`right ${app.workspace.rightSplit.collapsed ? "collapsed" : "open"}`;
}

/* ---- boot ---------------------------------------------------------------- */

const boot = async (): Promise<void> => {
	paintControls(storedSettings);
	// Placement happens once, at layout-ready, from the settings that were
	// loaded — the same as in Obsidian.
	await plugin.onload();
	applyControls();

	document.getElementById("open")?.addEventListener("click", () => void openSidebar(plugin));
	document.getElementById("toggle")?.addEventListener("click", () => void toggleSidebar(plugin));
	for (const id of ["sidebarMode", "sidebarSide", "sidebarCollapseOnTap"]) {
		document.getElementById(id)?.addEventListener("change", () => {
				applyControls();
			report();
		});
	}
	document.getElementById("device")?.addEventListener("change", () => {
		setPlatform((document.getElementById("device") as HTMLSelectElement).value as never);
		report();
	});
	// Row taps are how a phone user drives the panel; the drawer's response
	// lands a tick later (the same 50ms the harness uses for its readout).
	document.body.addEventListener("click", () => window.setTimeout(report, 50));

	setPlatform("desktop");
	report();
};

// Exposed before the plugin boots, so the driver can wait for readiness.
(window as any).pluginSim = {
	plugin,
	app,
	settings,
	report,
	setPlatform,
	ready: false,
};

void boot().then(() => {
	(window as any).pluginSim.ready = true;
	report();
});
