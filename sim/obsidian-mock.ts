/**
 * A mock of the slice of Obsidian's API that the overlay touches, so the real
 * `overlay.ts` can be bundled and driven in a plain browser page.
 *
 * This is a development harness only -- it is not part of the plugin bundle
 * (esbuild aliases `obsidian` to this file for the sim build only).
 */

/* ---- DOM helpers Obsidian adds to HTMLElement ---------------------------- */

interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string>;
}

function applyInfo(el: HTMLElement, info?: DomElementInfo): HTMLElement {
	if (!info) return el;
	if (info.cls) {
		const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/);
		for (const c of classes) if (c) el.classList.add(c);
	}
	if (info.text !== undefined) el.textContent = info.text;
	if (info.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	return el;
}

export function installDomHelpers(): void {
	const proto = HTMLElement.prototype as any;
	if (proto.__subtleTocHelpers) return;
	proto.__subtleTocHelpers = true;

	proto.createEl = function (tag: string, info?: DomElementInfo) {
		const el = document.createElement(tag);
		applyInfo(el, info);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (info?: DomElementInfo) {
		return this.createEl("div", info);
	};
	proto.createSpan = function (info?: DomElementInfo) {
		return this.createEl("span", info);
	};
	proto.addClass = function (...cls: string[]) {
		this.classList.add(...cls);
	};
	proto.removeClass = function (...cls: string[]) {
		this.classList.remove(...cls);
	};
	proto.toggleClass = function (cls: string | string[], on: boolean) {
		const list = Array.isArray(cls) ? cls : [cls];
		for (const c of list) this.classList.toggle(c, on);
	};
	proto.hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	proto.setText = function (text: string) {
		this.textContent = text;
	};
	proto.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.detach = function () {
		this.remove();
	};
}

/* ---- Platform ------------------------------------------------------------ */

/** Mutable so the harness can switch between device profiles at runtime. */
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: false,
	isWin: false,
	isLinux: true,
	isSafari: false,
};

export function setPlatform(profile: "desktop" | "tablet" | "phone"): void {
	Platform.isDesktop = profile === "desktop";
	Platform.isDesktopApp = profile === "desktop";
	Platform.isMobile = profile !== "desktop";
	Platform.isMobileApp = profile !== "desktop";
	Platform.isPhone = profile === "phone";
	Platform.isTablet = profile === "tablet";
}

/* ---- metadata shapes ----------------------------------------------------- */

interface Pos {
	start: { line: number; col?: number; offset?: number };
	end: { line: number; col?: number; offset?: number };
}
interface HeadingCache {
	heading: string;
	level: number;
	position: Pos;
}
export interface ListItemCache {
	task?: string;
	parent: number;
	position: Pos;
}
interface SectionCache {
	type: string;
	position: Pos;
}
export interface CachedMetadata {
	headings?: HeadingCache[];
	listItems?: ListItemCache[];
	sections?: SectionCache[];
}

export class TFile {
	constructor(public path: string) {}
}

/* ---- app / vault --------------------------------------------------------- */

/** The event bus behind `app.workspace` and `app.metadataCache`. */
export class EventBus {
	private listeners = new Map<string, Array<(...args: any[]) => void>>();

	on(name: string, callback: (...args: any[]) => void) {
		const list = this.listeners.get(name) ?? [];
		list.push(callback);
		this.listeners.set(name, list);
		return { name, callback, unregister: () => this.off(name, callback) };
	}

	off(name: string, callback: (...args: any[]) => void): void {
		const list = this.listeners.get(name);
		if (!list) return;
		this.listeners.set(
			name,
			list.filter((cb) => cb !== callback),
		);
	}

	trigger(name: string, ...args: any[]): void {
		for (const cb of [...(this.listeners.get(name) ?? [])]) cb(...args);
	}
}

/**
 * The dock/drawer a side view lives in. Same shape as both
 * `WorkspaceSidedock` and `WorkspaceMobileDrawer`, which is what lets the
 * plugin treat them as one thing.
 */
export class MockDock {
	collapsed = true;
	readonly el: HTMLElement;
	constructor(cls: string) {
		this.el = document.createElement("div");
		this.el.className = cls;
		this.el.addClass("is-collapsed");
	}
	expand(): void {
		this.collapsed = false;
		this.el.removeClass("is-collapsed");
	}
	collapse(): void {
		this.collapsed = true;
		this.el.addClass("is-collapsed");
	}
	toggle(): void {
		if (this.collapsed) this.expand();
		else this.collapse();
	}
}

export class WorkspaceLeaf {
	view: View | null = null;
	readonly app: App;
	parent: unknown = null;
	constructor(app: App, public id: string) {
		this.app = app;
	}
	async setViewState(state: { type: string }): Promise<void> {
		const factory = this.app.viewFactories.get(state.type);
		if (!factory) throw new Error(`no view registered for type "${state.type}"`);
		const view = factory(this);
		this.view = view;
		view.containerEl.addClass("sim-leaf");
		this.app.workspace.leaves.push(this);
		if (view.onOpen) await view.onOpen();
	}
	getViewState(): { type: string } {
		return { type: this.view?.getViewType() ?? "" };
	}
}

/**
 * The slice of `Workspace` the plugin touches. Leaves are created on demand by
 * `ensureSideLeaf`, exactly as Obsidian does, and dropped into the dock element
 * the harness handed over.
 */
export class MockWorkspace extends EventBus {
	leaves: WorkspaceLeaf[] = [];
	activeLeaf: WorkspaceLeaf | null = null;
	private activeView: View | null = null;
	/** Every ensureSideLeaf call, so a test can assert the arguments. */
	sideLeafCalls: Array<{ type: string; side: string; options: Record<string, unknown> }> = [];
	leftSplit = new MockDock("sim-dock-left");
	rightSplit = new MockDock("sim-dock-right");

	constructor(readonly app: App) {
		super();
	}

	/** Which element a dock's content is attached to (set by the harness). */
	sideHosts: Record<"left" | "right", HTMLElement | null> = { left: null, right: null };

	setActiveView(view: View | null, leaf: WorkspaceLeaf | null = null): void {
		this.activeView = view;
		this.activeLeaf = leaf;
	}

	getLeavesOfType(type: string): WorkspaceLeaf[] {
		return this.leaves.filter((leaf) => leaf.view?.getViewType() === type);
	}

	getActiveViewOfType<T extends View>(type: new (...args: any[]) => T): T | null {
		return this.activeView instanceof type ? (this.activeView as T) : null;
	}

	onLayoutReady(callback: () => void): void {
		callback();
	}

	getRightLeaf(_split: boolean): WorkspaceLeaf | null {
		return null;
	}

	async ensureSideLeaf(
		type: string,
		side: string,
		options: Record<string, unknown> = {},
	): Promise<WorkspaceLeaf> {
		this.sideLeafCalls.push({ type, side, options });
		const dock = side === "left" ? this.leftSplit : this.rightSplit;
		let leaf = this.leaves.find((l) => l.id === `${side}:${type}`) ?? null;
		if (!leaf) {
			leaf = new WorkspaceLeaf(this.app, `${side}:${type}`);
			await leaf.setViewState({ type });
			this.sideHosts[side as "left" | "right"]?.appendChild(leaf.view!.containerEl);
		}
		if (options.active) {
			this.activeLeaf = leaf;
			this.activeView = leaf.view;
			this.trigger("active-leaf-change", leaf);
		}
		if (options.reveal) dock.expand();
		if (options.active || options.reveal) {
			this.trigger("layout-change");
		}
		return leaf;
	}
}

export class App {
	metadataCache = new (class extends EventBus {
		cache: CachedMetadata | null = null;
		getFileCache(_file: TFile | null): CachedMetadata | null {
			return this.cache;
		}
	})();
	workspace = new MockWorkspace(this);
	/** View factories registered by Plugin.registerView, keyed by type. */
	viewFactories = new Map<string, (leaf: WorkspaceLeaf) => View>();
	vault = {
		async process(_file: TFile, fn: (data: string) => string) {
			return fn("");
		},
	};
}

/** The base class real views extend; enough of it for `sidebar.ts`. */
export class Component {
	private cleanup: Array<() => void> = [];

	registerEvent(ref: { unregister?: () => void } | (() => void)): void {
		this.cleanup.push(typeof ref === "function" ? ref : () => ref.unregister?.());
	}

	register(fn: () => void): void {
		this.cleanup.push(fn);
	}

	registerDomEvent(el: HTMLElement, evt: string, cb: EventListener): void {
		el.addEventListener(evt, cb);
		this.cleanup.push(() => el.removeEventListener(evt, cb));
	}

	unload(): void {
		for (const fn of this.cleanup.splice(0)) fn();
	}
}

export class View extends Component {
	readonly app: App;
	readonly leaf: WorkspaceLeaf;
	readonly containerEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super();
		this.leaf = leaf;
		this.app = leaf.app;
		this.containerEl = document.createElement("div");
	}

	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	getIcon(): string {
		return "";
	}
	async onOpen(): Promise<void> {}
	async onClose(): Promise<void> {}
}

export class ItemView extends View {
	readonly contentEl: HTMLElement;
	private readonly actionsEl: HTMLElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.containerEl.addClass("workspace-leaf", "sim-panel-leaf");
		this.actionsEl = this.containerEl.createDiv({ cls: "view-header-actions" });
		this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
	}

	addAction(icon: string, title: string, callback: (evt: MouseEvent) => unknown): HTMLElement {
		const btn = this.actionsEl.createDiv({ cls: "view-action" });
		btn.setAttribute("aria-label", title);
		btn.setAttribute("data-icon", icon);
		btn.addEventListener("click", callback as EventListener);
		return btn;
	}
}

/**
 * The plugin base. `registerView` records the factory on the app, which is how
 * `ensureSideLeaf` can build a view the way Obsidian does.
 */
export class Plugin {
	app: App;
	manifest: { id: string; version: string };
	settings: Record<string, unknown> = {};
	savedData: unknown = null;

	constructor(app: App, manifest: { id: string; version: string }) {
		this.app = app;
		this.manifest = manifest;
	}

	registerView(type: string, factory: (leaf: WorkspaceLeaf) => View): void {
		this.app.viewFactories.set(type, factory);
	}
	addCommand(_command: unknown): void {}
	addSettingTab(_tab: unknown): void {}
	registerEvent(ref: { unregister?: () => void } | (() => void)): void {
		if (typeof ref !== "function") ref.unregister?.();
	}
	async loadData(): Promise<unknown> {
		return this.savedData;
	}
	async saveData(data: unknown): Promise<void> {
		this.savedData = data;
	}
}
/**
 * Real Obsidian declares display/hide/update/refreshDomState on SettingTab,
 * and the settings tab calls super.hide(), so the stub needs them to exist.
 */
export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: unknown;

	constructor(app?: unknown, plugin?: unknown) {
		this.app = app;
		this.plugin = plugin;
	}

	display(): void {}
	hide(): void {}
	update(): void {}
	refreshDomState(): void {}
}
export class Setting {}
export class MarkdownView {}
