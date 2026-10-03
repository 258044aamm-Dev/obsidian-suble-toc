import { CachedMetadata, MarkdownView } from "obsidian";
import { OutlineNode } from "./types";
import { completeTask, getActiveHeadingIndex, getScroller, scrollToTarget } from "./dom";
import { buildOutline, countOf, flattenAll, flattenVisible, headingsOf } from "./outline";
import {
	createCheckboxIcon,
	createChevronIcon,
	createHeadingIcon,
	createListIcon,
	STATUS_GLYPH,
} from "./icons";
import type SubtleTocPlugin from "./main";

type TocTab = "headings" | "tasks";

/** Indent, in px, applied per level of outline depth. */
const INDENT_PX = 12;
/** Window after a click during which the list auto-scrolls stay suppressed. */
const NAV_SETTLE_MS = 400;

/**
 * What a surface wants to know about the tree it is showing.
 *
 * Every callback is optional and the renderer never reaches back into the
 * surface that owns it: the floating overlay subscribes to all of them, the
 * sidebar only to the ones it needs. That is the point of the split — one
 * renderer, two surfaces, no second copy of the row logic to drift.
 */
export interface TreeCallbacks {
	/** The active heading index changed (-1 = none). */
	onActiveChange?(index: number, heading: OutlineNode | undefined): void;
	/** The visible tab changed. */
	onTabChange?(tab: TocTab): void;
	/** Open and total task counts changed (the edge badge, tab labels). */
	onTaskCountChange?(open: number, shown: number): void;
	/** A row was hovered or left — the overlay's hover preview uses these. */
	onRowHover?(node: OutlineNode): void;
	onRowLeave?(): void;
	/** A row is about to navigate, and has finished navigating. */
	onNavigateStart?(): void;
	onNavigated?(node: OutlineNode): void;
	/** Whether the surface is currently on screen. A hidden surface takes a
	 *  fresh tab correction on refresh; a visible one keeps the user's choice. */
	isSurfaceVisible?(): boolean;
	/** Whether the surface wants the active row kept in view. */
	canAutoScrollActive?(): boolean;
}

/**
 * Renders the outline tree — tabs, rows, folding, completion, active tracking
 * and click-to-navigate — and nothing about where it is shown.
 *
 * Extracted from `TocOverlay`, which used to own both this and the floating
 * chrome. Two surfaces now host it: the popover inside the overlay, and the
 * sidebar view. Everything a reader sees in either place comes from here, so
 * "the sidebar shows what the popover shows" is structural rather than a
 * promise to keep two renderers in step.
 */
export class OutlineTreeRenderer {
	private plugin: SubtleTocPlugin;
	private getView: () => MarkdownView | null;
	private cb: TreeCallbacks;

	/** The element carrying the mode/tab state classes, when it is not the
	 *  element the tree is mounted in (the overlay's root vs its popover). */
	private stateHost!: HTMLElement;
	private surfaceHostMarker = "subtle-toc-surface-host";
	private bodyEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private headingsTabEl!: HTMLElement;
	private tasksTabEl!: HTMLElement;
	private tasksCountEl: HTMLElement | null = null;
	private listEl!: HTMLElement;

	/** The outline tree every surface renders from. */
	private tree: OutlineNode[] = [];
	/** Headings only, in document order — active tracking. */
	private headings: OutlineNode[] = [];
	/** The rows currently rendered, in display order. */
	private visible: OutlineNode[] = [];
	/** Memo for hasRenderableDescendant, rebuilt on each render. */
	private foldableMemo = new Map<OutlineNode, boolean>();
	/** Rendered row elements, keyed by node id, for reuse across refreshes. */
	private rowEls = new Map<string, HTMLElement>();
	/** Lines whose children are folded. */
	private collapsed = new Set<number>();
	/** Lines completed via the TOC this session — filtered out so a struck task
	 *  stays hidden on the next open even before the metadata cache catches up. */
	private completedLines = new Set<number>();
	private activeIndex = -1;
	/** Starts on the configured default tab, then follows the last-used one. */
	private activeTab: TocTab;
	private mounted = false;

	private scroller: HTMLElement | null = null;
	private rafPending = false;
	private readonly onScroll = () => this.scheduleActiveUpdate();
	/** True during TOC-driven scrolling; suppresses the list's active-item
	 *  auto-scroll so it doesn't slide under the cursor. */
	private navigating = false;
	private navTimer: number | null = null;

	constructor(options: {
		plugin: SubtleTocPlugin;
		/** The note this tree describes. Null when nothing is open. */
		getView(): MarkdownView | null;
		callbacks?: TreeCallbacks;
	}) {
		this.plugin = options.plugin;
		this.getView = options.getView;
		this.cb = options.callbacks ?? {};
		this.activeTab = options.plugin.settings.defaultTab;
	}

	private get settings() {
		return this.plugin.settings;
	}

	private get view(): MarkdownView | null {
		return this.getView();
	}

	/** Unified mode renders one nested tree; tabs mode keeps the original split. */
	private get unified(): boolean {
		return this.settings.outlineMode === "unified";
	}

	get headingsAll(): OutlineNode[] {
		return this.headings;
	}

	get isEmpty(): boolean {
		return flattenAll(this.tree).length === 0;
	}

	/** Total tasks in the note, whatever their status. */
	get taskCount(): number {
		return this.countKind("task");
	}

	/** Open tasks that are still open — what an edge badge counts. */
	get openTaskCount(): number {
		return countOf(
			this.tree,
			(n) => n.kind === "task" && n.statusKey === "todo" && !this.completedLines.has(n.line),
		);
	}

	/** The scroll container of the note this tree describes. */
	get scrollerEl(): HTMLElement | null {
		return this.scroller;
	}

	/** The tab bar, for a surface that needs to place its own chrome in it. */
	get tabBar(): HTMLElement {
		return this.tabsEl;
	}

	private get isSurfaceVisible(): boolean {
		return this.cb.isSurfaceVisible?.() ?? true;
	}

	// ---- lifecycle ---------------------------------------------------------

	/**
	 * Build the tree's DOM inside `container`.
	 *
	 * `stateHost` receives the mode and active-tab classes, for surfaces whose
	 * own element is not the one the tree sits in — the overlay keeps them on
	 * its root so the popover/sheet CSS can see them. Defaults to `container`.
	 */
	mount(container: HTMLElement, stateHost: HTMLElement = container): void {
		if (this.mounted) return;
		this.mounted = true;
		this.stateHost = stateHost;
		stateHost.addClass(this.surfaceHostMarker);

		this.bodyEl = container.createDiv({ cls: "subtle-toc-body" });

		this.tabsEl = this.bodyEl.createDiv({ cls: "subtle-toc-tabs" });
		// The default tab leads the tab bar (createTab appends in call order).
		if (this.settings.defaultTab === "tasks") {
			this.tasksTabEl = this.createTab("tasks", "Tasks");
			this.headingsTabEl = this.createTab("headings", "Headings");
		} else {
			this.headingsTabEl = this.createTab("headings", "Headings");
			this.tasksTabEl = this.createTab("tasks", "Tasks");
		}

		this.listEl = this.bodyEl.createDiv({ cls: "subtle-toc-list" });
		this.rebindScroller();
	}

	destroy(): void {
		if (!this.mounted) return;
		this.mounted = false;
		this.detachScroller();
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.navTimer = null;
		this.rowEls.clear();
		this.bodyEl?.remove();
	}

	// ---- tabs --------------------------------------------------------------

	private createTab(tab: TocTab, label: string): HTMLElement {
		const btn = this.tabsEl.createDiv({ cls: "subtle-toc-tab" });
		const icon = btn.createSpan({ cls: "subtle-toc-tab-icon" });
		if (tab === "tasks") createCheckboxIcon(icon);
		else createHeadingIcon(icon);
		btn.createSpan({ cls: "subtle-toc-tab-label", text: label });
		if (tab === "tasks") {
			this.tasksCountEl = btn.createSpan({ cls: "subtle-toc-tab-count" });
		}
		// Don't let the click pull focus off the editor (would swallow it) or bubble
		// up to a surface's own open/close handlers.
		btn.addEventListener("pointerdown", (e) => e.preventDefault());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.selectTab(tab);
			this.renderRows();
		});
		return btn;
	}

	/** Switch the visible list; the tab bar itself only appears when both exist. */
	private selectTab(tab: TocTab): void {
		if (tab === this.activeTab && this.bodyEl.hasClass(`is-tab-${tab}`)) return;
		this.activeTab = tab;
		this.stateHost.toggleClass("is-tab-headings", tab === "headings");
		this.stateHost.toggleClass("is-tab-tasks", tab === "tasks");
		this.headingsTabEl?.toggleClass("is-active", tab === "headings");
		this.tasksTabEl?.toggleClass("is-active", tab === "tasks");
		this.cb.onTabChange?.(tab);
	}

	/** Re-apply the active tab (keeping the last-used one when it has content, or
	 *  falling back to the tab that does). Always calls selectTab so the tab's
	 *  state classes are in sync — including the very first refresh. */
	private ensureValidTab(): void {
		const hasHeadings = this.headings.length > 0;
		const hasTasks = this.taskCount > 0;
		let tab = this.activeTab;
		if (tab === "headings" && !hasHeadings && hasTasks) tab = "tasks";
		else if (tab === "tasks" && !hasTasks && hasHeadings) tab = "headings";
		this.selectTab(tab);
	}

	// ---- data --------------------------------------------------------------

	private countKind(kind: OutlineNode["kind"]): number {
		return countOf(this.tree, (n) => n.kind === kind);
	}

	/** Re-read the note from the metadata cache and rebuild everything. */
	refresh(): void {
		if (!this.mounted) return;
		this.applyModes();
		this.rebindScroller();

		const cache = this.currentCache();
		const view = this.view;
		const lines = view ? view.getViewData().split("\n") : [];
		this.tree = buildOutline(cache, lines, this.settings);
		this.headings = headingsOf(this.tree);
		this.reconcileCompletedLines();

		const hasHeadings = this.headings.length > 0;
		this.headingsTabEl.toggleClass("is-hidden", !hasHeadings);

		const open = this.openTaskCount;
		const shown = this.taskCount;
		this.tasksTabEl.toggleClass("is-hidden", shown === 0);
		this.tasksCountEl?.setText(String(open));
		this.cb.onTaskCountChange?.(open, shown);

		// Preserve the last-used tab across opens; only correct it when the current
		// tab has no content in this note. Skipped while the surface is on screen,
		// so a background refresh never yanks the visible list to another tab.
		if (!this.isSurfaceVisible) this.ensureValidTab();

		this.renderRows();
		this.activeIndex = -1;
		this.updateActive();
	}

	/**
	 * Reconcile the completed-bridge: a line stays hidden only while the cache
	 * still reports it as an open task (the lag between our edit and the
	 * reparse). Once the cache catches up — done, removed, or re-opened — drop
	 * it, so a task unchecked in the note reappears here.
	 */
	private reconcileCompletedLines(): void {
		if (this.completedLines.size === 0) return;
		const stillOpen = new Set<number>();
		for (const node of flattenAll(this.tree)) {
			if (node.kind === "task" && node.statusKey === "todo") stillOpen.add(node.line);
		}
		for (const line of [...this.completedLines]) {
			if (!stillOpen.has(line)) this.completedLines.delete(line);
		}
	}

	private currentCache(): CachedMetadata | null {
		const view = this.view;
		const file = view?.file;
		return file ? this.plugin.app.metadataCache.getFileCache(file) : null;
	}

	/** Mode and wrap classes live on the state host, next to the tab classes. */
	private applyModes(): void {
		this.stateHost.toggleClass("is-unified", this.unified);
		this.stateHost.toggleClass("is-multiline", this.settings.multiLine);
	}

	// ---- row rendering -----------------------------------------------------

	/** Which nodes the active view shows. */
	private accepts(node: OutlineNode): boolean {
		if (node.kind === "task" && this.completedLines.has(node.line)) return false;
		if (this.unified) return true;
		return this.activeTab === "tasks" ? node.kind === "task" : node.kind !== "task";
	}

	/**
	 * Render the visible rows, reusing the element already created for a node
	 * where one exists. Obsidian's metadata cache fires on every edit, and the
	 * previous implementation emptied and recreated the entire list each time —
	 * which also meant losing hover state and scroll position mid-typing.
	 */
	private renderRows(): void {
		this.visible = flattenVisible(this.tree, this.collapsed, (n) => this.accepts(n));

		// Indent by *visible* ancestors, not absolute tree depth. In a filtered
		// view -- the Tasks tab, or `show: tasks` -- the headings a task hangs
		// from are not rendered, and inheriting their depth would indent rows
		// by an amount with nothing on screen to explain it.
		const shown = new Set(this.visible);
		this.foldableMemo = new Map();
		const displayDepth = (node: OutlineNode): number => {
			let depth = 0;
			for (let p = node.parent; p; p = p.parent) if (shown.has(p)) depth++;
			return depth;
		};

		const keep = new Set<string>();
		const fragment = document.createDocumentFragment();

		for (const node of this.visible) {
			keep.add(node.id);
			const row = this.rowEls.get(node.id) ?? this.createRow(node);
			this.updateRow(row, node, displayDepth(node));
			fragment.appendChild(row);
		}

		for (const [id, el] of this.rowEls) {
			if (!keep.has(id)) {
				el.remove();
				this.rowEls.delete(id);
			}
		}

		this.listEl.empty();
		this.listEl.appendChild(fragment);

		if (this.visible.length === 0) {
			this.listEl.createDiv({
				cls: "subtle-toc-empty-msg",
				text: this.emptyMessage(),
			});
		}

		// updateRow() resets className, so the active marker has to be re-applied
		// after every render rather than only when the active heading changes.
		this.syncActiveRow();
	}

	private emptyMessage(): string {
		if (!this.unified && this.activeTab === "tasks") return "No open tasks in this note.";
		if (!this.unified) return "No headings in this note.";
		return "Nothing to outline in this note.";
	}

	private createRow(node: OutlineNode): HTMLElement {
		const row = document.createElement("div");
		row.addClass("subtle-toc-item");

		// Fold control. Always present on a foldable row so the text column
		// lines up whether or not a row has children.
		const twisty = document.createElement("div");
		twisty.addClass("subtle-toc-twisty");
		createChevronIcon(twisty);
		twisty.addEventListener("pointerdown", (e) => e.preventDefault());
		twisty.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleCollapse(node);
		});
		row.appendChild(twisty);

		if (node.kind === "task") {
			const box = document.createElement("div");
			box.addClass("subtle-toc-task-check");
			box.setAttribute("role", "checkbox");
			// The checkbox completes the task; keep that click from also
			// navigating or stealing the editor's focus.
			box.addEventListener("pointerdown", (e) => e.preventDefault());
			box.addEventListener("click", (e) => {
				e.stopPropagation();
				this.completeTaskNode(node, row);
			});
			row.appendChild(box);
		} else if (node.kind === "callout") {
			const mark = document.createElement("span");
			mark.addClass("subtle-toc-kind-mark");
			createListIcon(mark);
			row.appendChild(mark);
		}

		const text = document.createElement("span");
		text.addClass("subtle-toc-item-text");
		row.appendChild(text);

		// Keep focus on the editor so a single click navigates (no focus-steal
		// that would swallow the click on the floating overlay).
		row.addEventListener("pointerdown", (e) => e.preventDefault());
		row.addEventListener("click", () => this.navigate(node));
		row.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.cb.onRowHover?.(node);
		});
		row.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "touch") return;
			this.cb.onRowLeave?.();
		});

		this.rowEls.set(node.id, row);
		return row;
	}

	private updateRow(row: HTMLElement, node: OutlineNode, depth: number): void {
		row.className = "subtle-toc-item";
		row.addClass(`subtle-toc-kind-${node.kind}`);
		if (node.kind === "heading") row.addClass(`subtle-toc-level-${node.rawLevel}`);
		if (node.statusKey) row.addClass(`subtle-toc-status-${node.statusKey}`);
		if (this.completedLines.has(node.line)) row.addClass("is-done");

		row.style.setProperty("--toc-indent", String(depth));
		row.style.setProperty("--toc-indent-px", `${depth * INDENT_PX}px`);

		const foldable = this.settings.collapsible && this.hasRenderableDescendant(node);
		const isCollapsed = this.collapsed.has(node.line);
		row.toggleClass("is-foldable", foldable);
		row.toggleClass("is-collapsed", foldable && isCollapsed);

		const text = row.querySelector<HTMLElement>(".subtle-toc-item-text");
		if (text) text.setText(node.text);

		const box = row.querySelector<HTMLElement>(".subtle-toc-task-check");
		if (box) {
			const status = node.statusKey ?? "other";
			const done = this.completedLines.has(node.line) || status === "done";
			box.setAttribute("aria-checked", done ? "true" : "false");
			box.setText(done ? "✓" : STATUS_GLYPH[status]);
			// Only a genuinely open task can be completed from here; other
			// statuses are shown for context and are not clickable.
			box.toggleClass("is-actionable", status === "todo" && !done);
			box.toggleClass("is-hidden", !this.settings.showTaskCheckboxes && status === "todo");
		}

		// Single-line rows cut long text, so the full version lives in a
		// tooltip; wrapped rows already show all of it.
		if (!this.settings.multiLine) row.setAttribute("aria-label", node.text);
		else row.removeAttribute("aria-label");
	}

	/**
	 * Whether folding this row would actually hide anything.
	 *
	 * Deliberately independent of the current collapse state: a collapsed row
	 * has no visible children by definition, so testing the rendered set would
	 * make the chevron vanish the moment it was used and leave the row stuck
	 * shut. It does respect the active filter, so a heading whose only children
	 * are tasks is not foldable while the Headings tab is showing.
	 */
	private hasRenderableDescendant(node: OutlineNode): boolean {
		const memo = this.foldableMemo.get(node);
		if (memo !== undefined) return memo;
		let result = false;
		for (const child of node.children) {
			if (this.accepts(child) || this.hasRenderableDescendant(child)) {
				result = true;
				break;
			}
		}
		this.foldableMemo.set(node, result);
		return result;
	}

	private toggleCollapse(node: OutlineNode): void {
		if (!this.settings.collapsible || !this.hasRenderableDescendant(node)) return;
		if (this.collapsed.has(node.line)) this.collapsed.delete(node.line);
		else this.collapsed.add(node.line);
		this.renderRows();
	}

	/**
	 * Complete a task node: flip it done in the note and strike its row.
	 * The row stays (struck) until the next refresh so the list doesn't reflow
	 * under the cursor; `completedLines` keeps it hidden from then on.
	 */
	private completeTaskNode(node: OutlineNode, row: HTMLElement): void {
		if (node.statusKey !== "todo") return;
		if (row.hasClass("is-done")) return;
		const view = this.view;
		if (!view) return;
		if (!completeTask(this.plugin.app, view, node.line)) return;
		this.completedLines.add(node.line);
		row.addClass("is-done");
		row.querySelector<HTMLElement>(".subtle-toc-task-check")?.setAttribute(
			"aria-checked",
			"true",
		);
		// Reflect the completion in the counts right away (the struck row itself
		// stays until the next refresh).
		const open = this.openTaskCount;
		this.tasksCountEl?.setText(String(open));
		this.cb.onTaskCountChange?.(open, this.taskCount);
	}

	// ---- active heading tracking -------------------------------------------

	private rebindScroller(): void {
		const view = this.view;
		const next = view ? getScroller(view) : null;
		if (next === this.scroller) return;
		this.detachScroller();
		this.scroller = next;
		this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
	}

	private detachScroller(): void {
		this.scroller?.removeEventListener("scroll", this.onScroll);
		this.scroller = null;
	}

	/** Recompute the active heading on the next frame. A surface that moves the
	 *  note's scroll position itself calls this to resync the highlight. */
	scheduleActiveUpdate(): void {
		if (this.rafPending) return;
		this.rafPending = true;
		requestAnimationFrame(() => {
			this.rafPending = false;
			this.updateActive();
		});
	}

	private updateActive(): void {
		const view = this.view;
		this.setActive(view ? getActiveHeadingIndex(view, this.headings) : -1);
	}

	/** Move the active highlight to `next`, always clearing the previous one. */
	private setActive(next: number): void {
		if (next === this.activeIndex) return;

		this.rowForIndex(this.activeIndex)?.removeClass("is-active");

		this.activeIndex = next;
		if (next >= 0) this.syncActiveRow();

		this.cb.onActiveChange?.(this.activeIndex, this.headings[this.activeIndex]);
	}

	/** The rendered row for a heading index, if that heading is visible. */
	private rowForIndex(index: number): HTMLElement | undefined {
		if (index < 0) return undefined;
		const node = this.headings[index];
		return node ? this.rowEls.get(node.id) : undefined;
	}

	syncActiveRow(): void {
		const row = this.rowForIndex(this.activeIndex);
		if (!row) return;
		row.addClass("is-active");
		// Skip while the TOC is navigating: the active heading can sweep past
		// the intermediate ones as the note scrolls, and auto-scrolling the
		// list to each would slide it under the cursor.
		if (this.cb.canAutoScrollActive?.() !== false && !this.navigating) {
			row.scrollIntoView({ block: "nearest" });
		}
	}

	/** Highlight the row for a heading index without navigating (minimap peek). */
	setPeek(index: number | null): void {
		const node = index === null ? undefined : this.headings[index];
		for (const [id, el] of this.rowEls) el.toggleClass("is-peek", id === node?.id);
	}

	clearPeek(): void {
		this.setPeek(null);
	}

	// ---- interactions ------------------------------------------------------

	/** Mark a TOC-driven scroll in progress so the list stays put while the
	 *  active heading sweeps through the ones between here and the target;
	 *  otherwise its auto-scroll (see syncActiveRow) slides it under the cursor.
	 *  The window covers the scroll animation plus its trailing scroll events. */
	private beginNavigation(): void {
		this.navigating = true;
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.navTimer = window.setTimeout(() => {
			this.navigating = false;
			this.navTimer = null;
		}, NAV_SETTLE_MS);
	}

	/** Scroll the note to a row. Shared by every surface that shows the tree. */
	navigate(node: OutlineNode): void {
		const view = this.view;
		if (!view) return;
		this.cb.onNavigateStart?.();
		this.beginNavigation();
		const kind = node.kind === "task" ? "task" : "heading";
		scrollToTarget(view, node, this.settings.smoothScroll, kind);
		if (node.kind === "heading") {
			// optimistic highlight; the scroll listener will confirm/correct
			const index = this.headings.indexOf(node);
			if (index >= 0) this.setActive(index);
		}
		this.cb.onNavigated?.(node);
	}

	/** Scroll the note to a heading without moving the editor cursor, for the
	 *  overlay's hover preview. */
	previewHeading(node: OutlineNode): void {
		const view = this.view;
		if (!view) return;
		this.beginNavigation();
		scrollToTarget(view, node, false, "heading", false);
		const index = this.headings.indexOf(node);
		if (index >= 0) this.setActive(index);
	}
}
