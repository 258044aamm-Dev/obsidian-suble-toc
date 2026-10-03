import { CachedMetadata, MarkdownView, Platform } from "obsidian";
import { OutlineNode, TaskStatusKey } from "./types";
import { completeTask, getActiveHeadingIndex, getScroller, scrollToTarget } from "./dom";
import { buildOutline, countOf, flattenAll, flattenVisible, headingsOf } from "./outline";
import type SubtleTocPlugin from "./main";

type TocTab = "headings" | "tasks";

const SVG_NS = "http://www.w3.org/2000/svg";
/** Extra hierarchy spread applied only to minimap widths above 100%. */
const MINIMAP_HIERARCHY_SPREAD = 0.5;
/** Indent, in px, applied per level of outline depth. */
const INDENT_PX = 12;

type SvgChild = [tag: string, attrs: Record<string, string>];

/**
 * Append an inline Lucide-style icon. Drawn by hand rather than via `setIcon`
 * so it renders regardless of the host's icon-registry version.
 */
function createIcon(parent: HTMLElement, children: SvgChild[]): SVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	const attrs: Record<string, string> = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
	};
	for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
	svg.classList.add("subtle-toc-icon");

	for (const [tag, childAttrs] of children) {
		const node = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(childAttrs)) node.setAttribute(k, v);
		svg.appendChild(node);
	}

	parent.appendChild(svg);
	return svg;
}

/** Lucide "square-check". */
function createCheckboxIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
		["path", { d: "m9 12 2 2 4-4" }],
	]);
}

/** Lucide "heading" (an "H"). */
function createHeadingIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M6 12h12" }],
		["path", { d: "M6 20V4" }],
		["path", { d: "M18 20V4" }],
	]);
}

/** Lucide "list" — the note-header button and the unified tab. */
function createListIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M8 6h13" }],
		["path", { d: "M8 12h13" }],
		["path", { d: "M8 18h13" }],
		["path", { d: "M3 6h.01" }],
		["path", { d: "M3 12h.01" }],
		["path", { d: "M3 18h.01" }],
	]);
}

/** Lucide "chevron-right", rotated by CSS when the row is expanded. */
function createChevronIcon(parent: HTMLElement): void {
	createIcon(parent, [["path", { d: "m9 18 6-6-6-6" }]]);
}

/** Lucide "x" for the mobile sheet's close button. */
function createCloseIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M18 6 6 18" }],
		["path", { d: "m6 6 12 12" }],
	]);
}

/** The glyph drawn in a task row's status box, per canonical status. */
const STATUS_GLYPH: Record<TaskStatusKey, string> = {
	todo: "",
	done: "✓",
	inProgress: "/",
	cancelled: "–",
	forwarded: "›",
	question: "?",
	important: "!",
	other: "•",
};

/**
 * Owns all DOM and listeners for the floating TOC of a single MarkdownView.
 * The plugin creates one of these per active view and tears it down when the
 * active view changes.
 */
export class TocOverlay {
	private plugin: SubtleTocPlugin;
	readonly view: MarkdownView;

	private rootEl!: HTMLElement;
	private groupEl!: HTMLElement;
	private edgeEl!: HTMLElement;
	private minimapEl!: HTMLElement;
	private taskBadgeEl!: HTMLElement;
	private popoverEl!: HTMLElement;
	private backdropEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private headingsTabEl!: HTMLElement;
	private tasksTabEl!: HTMLElement;
	private tasksCountEl!: HTMLElement;
	private listEl!: HTMLElement;
	/** The note-header action button, when one is installed. */
	private headerButtonEl: HTMLElement | null = null;

	/** The outline tree every view renders from. */
	private tree: OutlineNode[] = [];
	/** Headings only, in document order — minimap and active tracking. */
	private headings: OutlineNode[] = [];
	/** The rows currently rendered, in display order. */
	private visible: OutlineNode[] = [];
	/** Memo for hasRenderableDescendant, rebuilt on each render. */
	private foldableMemo = new Map<OutlineNode, boolean>();
	private dashEls: HTMLElement[] = [];
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
	private isOpen = false;
	/** True when the popover is showing as a mobile sheet. */
	private sheetMode = false;

	private scroller: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private rafPending = false;
	private readonly onScroll = () => this.scheduleActiveUpdate();
	/** True during TOC-driven scrolling; suppresses the popover list's
	 *  active-item auto-scroll so it doesn't slide under the cursor. */
	private navigating = false;
	private navTimer: number | null = null;
	/** Scroll position to restore when hover preview ends without a click. */
	private hoverPreviewOrigin: { scroller: HTMLElement; scrollTop: number } | null = null;
	/** Deferred restore lets the pointer cross directly between heading rows. */
	private hoverPreviewRestoreFrame: number | null = null;

	constructor(plugin: SubtleTocPlugin, view: MarkdownView) {
		this.plugin = plugin;
		this.view = view;
		this.activeTab = plugin.settings.defaultTab;
	}

	private get settings() {
		return this.plugin.settings;
	}

	/** Unified mode renders one nested tree; tabs mode keeps the original split. */
	private get unified(): boolean {
		return this.settings.outlineMode === "unified";
	}

	/** Phones get the header button and the sheet instead of the edge strip. */
	private get isPhone(): boolean {
		return Platform.isPhone;
	}

	// ---- lifecycle ---------------------------------------------------------

	mount(): void {
		const host = this.view.contentEl;
		host.addClass("subtle-toc-host");

		this.rootEl = host.createDiv({ cls: "subtle-toc-root" });
		// Sits behind the sheet on touch so a tap outside dismisses it. It is
		// inert (and invisible) unless the sheet is open.
		this.backdropEl = this.rootEl.createDiv({ cls: "subtle-toc-backdrop" });
		this.groupEl = this.rootEl.createDiv({ cls: "subtle-toc-group" });

		// The edge stacks the dashes minimap over the task badge (either can be
		// hidden). Kept out of the minimap's clipped/max-height box.
		this.edgeEl = this.groupEl.createDiv({ cls: "subtle-toc-edge" });
		this.minimapEl = this.edgeEl.createDiv({ cls: "subtle-toc-minimap" });
		this.taskBadgeEl = this.edgeEl.createDiv({ cls: "subtle-toc-task-badge is-hidden" });
		this.popoverEl = this.groupEl.createDiv({ cls: "subtle-toc-popover" });

		this.buildPopoverChrome();
		this.bindGroupEvents();
		this.applySide();
		this.applyMinimapSizing();
		this.installHeaderButton();
	}

	/**
	 * Pin the dash height (and gap) to a whole number of *device* pixels so the
	 * 2px hairlines render as solid blocks instead of antialiasing to different
	 * apparent heights under fractional display scaling (e.g. Windows 125%).
	 */
	private applyMinimapSizing(): void {
		const dpr = window.devicePixelRatio || 1;
		const snap = (cssPx: number, minDevicePx: number) =>
			Math.max(minDevicePx, Math.round(cssPx * dpr)) / dpr;
		const widthScale = Math.min(2, Math.max(0.5, this.settings.minimapWidthScale / 100));
		const verticalScale = Math.min(
			2,
			Math.max(0.5, this.settings.minimapVerticalScale / 100),
		);
		const width = (cssPx: number, scale = widthScale) =>
			`${Number((cssPx * scale).toFixed(2))}px`;
		const levelWidths = [14, 12.4, 10.8, 9.2, 7.6, 6];
		const extraScale = Math.max(0, widthScale - 1);

		this.minimapEl.style.setProperty("--toc-dash-h", `${snap(2 * verticalScale, 1)}px`);
		this.minimapEl.style.setProperty("--toc-gap", `${snap(6 * verticalScale, 1)}px`);
		this.minimapEl.style.setProperty("--toc-dash-w", width(16));
		this.minimapEl.style.setProperty("--toc-dash-hover-w", width(22));
		this.minimapEl.style.setProperty("--toc-dash-active-w", width(14));
		levelWidths.forEach((base, index) => {
			// Above 100%, shallow headings receive progressively more growth. H1
			// gets the largest bonus and H6 keeps the selected base scale.
			const hierarchy = (levelWidths.length - 1 - index) / (levelWidths.length - 1);
			const levelScale =
				widthScale + extraScale * MINIMAP_HIERARCHY_SPREAD * hierarchy;
			this.minimapEl.style.setProperty(
				`--toc-level-${index + 1}-w`,
				width(base, levelScale),
			);
			this.minimapEl.style.setProperty(
				`--toc-active-level-${index + 1}-w`,
				width(14, levelScale),
			);
		});
	}

	/**
	 * Add the button to the note header that opens the outline.
	 *
	 * On phones the edge minimap is a ~16px strip that no finger can hit, so
	 * this is the only way in; `auto` therefore means "mobile only", and the
	 * setting lets desktop users who dislike hover opt in as well.
	 */
	private installHeaderButton(): void {
		this.removeHeaderButton();
		const mode = this.settings.headerButton;
		const wanted = mode === "always" || (mode === "auto" && Platform.isMobile);
		if (!wanted) return;

		this.headerButtonEl = this.view.addAction("list", "Open outline", () => this.toggle());
		this.headerButtonEl.addClass("subtle-toc-header-button");
	}

	private removeHeaderButton(): void {
		this.headerButtonEl?.remove();
		this.headerButtonEl = null;
	}

	unmount(): void {
		this.restoreHoverPreview(false);
		this.detachScroller();
		if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.cancelHoverPreviewRestore();
		this.removeHeaderButton();
		this.rootEl?.remove();
		this.rowEls.clear();
		this.view.contentEl.removeClass("subtle-toc-host");
	}

	// ---- DOM construction --------------------------------------------------

	private buildPopoverChrome(): void {
		const body = this.popoverEl.createDiv({ cls: "subtle-toc-body" });

		this.tabsEl = body.createDiv({ cls: "subtle-toc-tabs" });
		// The default tab leads the tab bar (createTab appends in call order).
		if (this.settings.defaultTab === "tasks") {
			this.tasksTabEl = this.createTab("tasks", "Tasks");
			this.headingsTabEl = this.createTab("headings", "Headings");
		} else {
			this.headingsTabEl = this.createTab("headings", "Headings");
			this.tasksTabEl = this.createTab("tasks", "Tasks");
		}

		// Only the sheet shows a close affordance; on desktop the popover still
		// closes by moving the pointer away.
		const close = this.tabsEl.createDiv({ cls: "subtle-toc-close" });
		createCloseIcon(close);
		close.setAttribute("aria-label", "Close outline");
		close.addEventListener("pointerdown", (e) => e.preventDefault());
		close.addEventListener("click", (e) => {
			e.stopPropagation();
			this.close();
		});

		this.listEl = body.createDiv({ cls: "subtle-toc-list" });
	}

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
		// up to the group's open/close handlers.
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
		if (tab !== "headings") this.restoreHoverPreview();
		this.activeTab = tab;
		this.rootEl.toggleClass("is-tab-headings", tab === "headings");
		this.rootEl.toggleClass("is-tab-tasks", tab === "tasks");
		this.headingsTabEl?.toggleClass("is-active", tab === "headings");
		this.tasksTabEl?.toggleClass("is-active", tab === "tasks");
	}

	/** Re-apply the active tab (keeping the last-used one when it has content, or
	 *  falling back to the tab that does). Always calls selectTab so the tab's
	 *  visibility class is in sync — including the very first open. */
	private ensureValidTab(): void {
		const hasHeadings = this.countKind("heading") > 0;
		const hasTasks = this.countKind("task") > 0;
		let tab = this.activeTab;
		if (tab === "headings" && !hasHeadings && hasTasks) tab = "tasks";
		else if (tab === "tasks" && !hasTasks && hasHeadings) tab = "headings";
		this.selectTab(tab);
	}

	private bindGroupEvents(): void {
		const trigger = this.settings.openTrigger;
		// Hover is a pointer-only affordance: on touch there is no hover state,
		// so the edge always behaves as tap-to-toggle there regardless of the
		// setting, and the header button is the primary entry point.
		const hoverOpens = trigger === "hover" && !Platform.isMobile;

		// Both the dashes and the task badge just open the popover on whatever tab
		// was last active — the tab choice is preserved across opens.
		for (const el of [this.minimapEl, this.taskBadgeEl]) {
			el.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "touch") return;
				if (hoverOpens) this.open();
			});
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				if (!hoverOpens) this.toggle();
			});
			el.addEventListener("pointerleave", (e) => {
				if (e.pointerType === "touch") return;
				this.scheduleClose();
			});
		}

		this.popoverEl.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.cancelClose();
		});
		this.popoverEl.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "touch") return;
			this.onPopoverLeave(e);
		});

		// Tapping the backdrop dismisses the sheet; it only receives events
		// while the sheet is open (see styles.css).
		this.backdropEl.addEventListener("click", (e) => {
			e.stopPropagation();
			this.close();
		});
	}

	/** Leaving sideways, back toward the note, reads as "done with it" — close at
	 *  once. Any other exit keeps the grace period, so the popover still survives
	 *  the cursor falling outside when a shorter tab shrinks it. */
	private onPopoverLeave(e: PointerEvent): void {
		if (this.sheetMode) return;
		const rect = this.popoverEl.getBoundingClientRect();
		const towardNote =
			this.settings.side === "left" ? e.clientX > rect.right : e.clientX < rect.left;
		if (!towardNote) {
			this.scheduleClose();
			return;
		}
		this.cancelClose();
		this.close();
	}

	/**
	 * Pin the popover's top edge once it is open.
	 *
	 * The popover is vertically centred by CSS (`top: 50%` + `translateY(-50%)`),
	 * which means any change in its height moves both edges. Folding a tall
	 * section shrinks it enough to slide out from under the pointer, and the
	 * resulting `pointerleave` closes the popover the moment the user folds
	 * something. Switching to a fixed top at open time keeps the rows the user
	 * is pointing at exactly where they are, however the content changes.
	 */
	private anchorPopover(): void {
		if (this.sheetMode) {
			// The sheet is viewport-centred and never anchored to the group.
			this.rootEl.removeClass("is-anchored");
			this.popoverEl.style.removeProperty("top");
			return;
		}
		const groupH = this.groupEl.clientHeight;
		const popH = this.popoverEl.offsetHeight;
		if (groupH <= 0 || popH <= 0) return;
		const top = Math.round(groupH / 2 - popH / 2);
		this.popoverEl.style.top = `${top}px`;
		this.rootEl.addClass("is-anchored");
	}

	private applySide(): void {
		this.rootEl.toggleClass("is-left", this.settings.side === "left");
		this.rootEl.toggleClass("is-right", this.settings.side === "right");
	}

	private applyTextWrap(): void {
		this.rootEl.toggleClass("is-multiline", this.settings.multiLine);
	}

	private applyPopoverWidth(): void {
		const width = Math.min(480, Math.max(160, this.settings.popoverWidth));
		this.rootEl.style.setProperty("--toc-popover-width", `${width}px`);
	}

	/** Publish the custom active-tab color; removed when unset so the CSS falls
	 *  back to the theme's own value. */
	private applyColors(): void {
		const color = this.settings.activeTabBgColor;
		if (color) this.rootEl.style.setProperty("--toc-active-tab-bg", color);
		else this.rootEl.style.removeProperty("--toc-active-tab-bg");
	}

	/** Mode classes that drive the unified/tabs and desktop/sheet layouts. */
	private applyModes(): void {
		this.rootEl.toggleClass("is-unified", this.unified);
		this.rootEl.toggleClass("is-phone", this.isPhone);
		this.rootEl.toggleClass("is-mobile", Platform.isMobile);
	}

	// ---- data refresh ------------------------------------------------------

	private countKind(kind: OutlineNode["kind"]): number {
		return countOf(this.tree, (n) => n.kind === kind);
	}

	/** Open tasks that are still open — what the edge badge counts. */
	private openTaskCount(): number {
		return countOf(
			this.tree,
			(n) => n.kind === "task" && n.statusKey === "todo" && !this.completedLines.has(n.line),
		);
	}

	/** Re-read the note from the metadata cache and rebuild everything. */
	refresh(): void {
		// Rebuilding the list removes its hover listeners, so finish any preview
		// before replacing the rows.
		this.restoreHoverPreview(false);
		this.applySide();
		this.applyColors();
		this.applyTextWrap();
		this.applyPopoverWidth();
		this.applyMinimapSizing();
		this.applyModes();
		this.rebindScroller();

		const cache = this.currentCache();
		const lines = this.view.getViewData().split("\n");
		this.tree = buildOutline(cache, lines, this.settings);
		this.headings = headingsOf(this.tree);
		this.reconcileCompletedLines();

		const hasHeadings = this.headings.length > 0;
		const hasContent = flattenAll(this.tree).length > 0;

		this.rootEl.toggleClass("is-empty", !hasContent);
		this.headingsTabEl.toggleClass("is-hidden", !hasHeadings);
		// Dashes honor the "show minimap" toggle; on a phone the strip is too
		// narrow to tap, so the header button stands in for it entirely.
		const minimapAllowed =
			this.settings.showMinimap && !(this.isPhone && this.settings.hideMinimapOnPhone);
		this.minimapEl.toggleClass("is-hidden", !minimapAllowed || !hasHeadings);

		this.refreshTaskChrome(minimapAllowed);

		// Preserve the last-used tab across opens; only correct it when the current
		// tab has no content in this note. Skipped while open so a background
		// refresh never yanks the popover to another tab.
		if (!this.isOpen) this.ensureValidTab();

		this.buildMinimap();
		this.renderRows();
		this.activeIndex = -1;
		this.updateActive();

		if (!hasContent) this.close();
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

	/** Update the tab count and the edge badge from the current tree. */
	private refreshTaskChrome(minimapAllowed: boolean): void {
		const open = this.openTaskCount();
		const shown = this.countKind("task");
		this.tasksTabEl.toggleClass("is-hidden", shown === 0);
		this.tasksCountEl?.setText(String(open));

		// With no headings the badge is the only way to open the popover, so the
		// toggle only suppresses it while the dashes can stand in as the trigger.
		const suppressed = !this.settings.showTasksInMinimap && this.headings.length > 0;
		this.taskBadgeEl.toggleClass(
			"is-hidden",
			!minimapAllowed || open === 0 || suppressed,
		);
		this.buildTaskBadge(open);
	}

	private buildMinimap(): void {
		this.minimapEl.empty();
		this.dashEls = this.headings.map((h, i) => {
			const dash = this.minimapEl.createDiv({
				cls: `subtle-toc-dash subtle-toc-level-${h.rawLevel}`,
			});
			dash.setAttribute("aria-label", h.text);
			dash.addEventListener("click", (e) => {
				e.stopPropagation();
				this.navigate(h);
			});
			dash.addEventListener("pointerenter", (e) => {
				if (e.pointerType === "touch") return;
				this.peek(i);
			});
			return dash;
		});
	}

	/** The checkbox + open-task count shown on the edge (below the dashes). */
	private buildTaskBadge(n: number): void {
		this.taskBadgeEl.empty();
		createCheckboxIcon(this.taskBadgeEl);
		this.taskBadgeEl.createSpan({ cls: "subtle-toc-task-badge-count", text: String(n) });
		this.taskBadgeEl.setAttribute("aria-label", `${n} open task${n === 1 ? "" : "s"}`);
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
		// by an amount with nothing on screen to explain it. A sub-task still
		// sits under its parent task, because that parent is visible.
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
		// that would swallow the click on this floating overlay).
		row.addEventListener("pointerdown", (e) => e.preventDefault());
		row.addEventListener("click", () => this.navigate(node));
		row.addEventListener("pointerenter", (e) => {
			if (e.pointerType === "touch") return;
			this.previewOnHover(node);
		});
		row.addEventListener("pointerleave", (e) => {
			if (e.pointerType === "touch") return;
			this.scheduleHoverPreviewRestore();
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
	 * The row stays (struck) until the next open() so the list doesn't reflow
	 * under the cursor; `completedLines` keeps it hidden from then on.
	 */
	private completeTaskNode(node: OutlineNode, row: HTMLElement): void {
		if (node.statusKey !== "todo") return;
		if (row.hasClass("is-done")) return;
		if (!completeTask(this.plugin.app, this.view, node.line)) return;
		this.completedLines.add(node.line);
		row.addClass("is-done");
		row.querySelector<HTMLElement>(".subtle-toc-task-check")?.setAttribute(
			"aria-checked",
			"true",
		);
		// Reflect the completion in the counts right away (the struck row itself
		// stays until the next open).
		const remaining = this.openTaskCount();
		this.tasksCountEl?.setText(String(remaining));
		this.buildTaskBadge(remaining);
	}

	// ---- active heading tracking ------------------------------------------

	private rebindScroller(): void {
		const next = getScroller(this.view);
		if (next === this.scroller) return;
		this.detachScroller();
		this.scroller = next;
		this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
	}

	private detachScroller(): void {
		this.scroller?.removeEventListener("scroll", this.onScroll);
		this.scroller = null;
	}

	private scheduleActiveUpdate(): void {
		if (this.rafPending) return;
		this.rafPending = true;
		requestAnimationFrame(() => {
			this.rafPending = false;
			this.updateActive();
		});
	}

	private updateActive(): void {
		this.setActive(getActiveHeadingIndex(this.view, this.headings));
	}

	/** Move the active highlight to `next`, always clearing the previous one. */
	private setActive(next: number): void {
		if (next === this.activeIndex) return;

		this.rowForIndex(this.activeIndex)?.removeClass("is-active");
		this.dashEls[this.activeIndex]?.removeClass("is-active");

		this.activeIndex = next;
		if (next >= 0) {
			this.dashEls[next]?.addClass("is-active");
			this.syncActiveRow();
		}
	}

	/** The rendered row for a heading index, if that heading is visible. */
	private rowForIndex(index: number): HTMLElement | undefined {
		if (index < 0) return undefined;
		const node = this.headings[index];
		return node ? this.rowEls.get(node.id) : undefined;
	}

	private syncActiveRow(): void {
		const row = this.rowForIndex(this.activeIndex);
		if (!row) return;
		row.addClass("is-active");
		// Skip while the TOC is navigating: the active heading can sweep past
		// the intermediate ones as the note scrolls, and auto-scrolling the
		// list to each would slide it under the cursor.
		if (this.isOpen && !this.navigating) {
			row.scrollIntoView({ block: "nearest" });
		}
	}

	// ---- interactions ------------------------------------------------------

	/** Mark a TOC-driven scroll in progress so the popover list stays put while
	 *  the active heading sweeps through the ones between here and the target;
	 *  otherwise its auto-scroll (see setActive) slides it under the cursor. The
	 *  window covers the scroll animation plus its trailing scroll events. */
	private beginNavigation(): void {
		this.navigating = true;
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.navTimer = window.setTimeout(() => {
			this.navigating = false;
			this.navTimer = null;
		}, 400);
	}

	private navigate(node: OutlineNode): void {
		this.commitHoverPreview();
		this.beginNavigation();
		const kind = node.kind === "task" ? "task" : "heading";
		scrollToTarget(this.view, node, this.settings.smoothScroll, kind);
		if (node.kind === "heading") {
			// optimistic highlight; the scroll listener will confirm/correct
			const index = this.headings.indexOf(node);
			if (index >= 0) this.setActive(index);
		}
		// A tap on a phone should hand the note back immediately.
		if (this.sheetMode) this.close();
	}

	/** Temporarily show a hovered row without moving the editor cursor or
	 *  flashing it. Leaving the rows restores the original viewport. */
	private previewOnHover(node: OutlineNode): void {
		if (!this.settings.scrollToHeadingOnHover) return;
		if (node.kind !== "heading") return;
		this.cancelHoverPreviewRestore();
		if (!this.hoverPreviewOrigin && this.scroller) {
			this.hoverPreviewOrigin = {
				scroller: this.scroller,
				scrollTop: this.scroller.scrollTop,
			};
		}
		this.beginNavigation();
		scrollToTarget(this.view, node, false, "heading", false);
		const index = this.headings.indexOf(node);
		if (index >= 0) this.setActive(index);
	}

	/** Delay restoration by one frame so moving directly to another heading row
	 *  continues the same preview instead of briefly jumping back. */
	private scheduleHoverPreviewRestore(): void {
		if (!this.hoverPreviewOrigin) return;
		this.cancelHoverPreviewRestore();
		this.hoverPreviewRestoreFrame = requestAnimationFrame(() => {
			this.hoverPreviewRestoreFrame = null;
			this.restoreHoverPreview();
		});
	}

	private cancelHoverPreviewRestore(): void {
		if (this.hoverPreviewRestoreFrame !== null) {
			cancelAnimationFrame(this.hoverPreviewRestoreFrame);
			this.hoverPreviewRestoreFrame = null;
		}
	}

	/** A click commits the current navigation, so a later pointerleave must not
	 *  return to the pre-preview viewport. */
	private commitHoverPreview(): void {
		this.cancelHoverPreviewRestore();
		this.hoverPreviewOrigin = null;
	}

	private restoreHoverPreview(updateActive = true): void {
		this.cancelHoverPreviewRestore();
		const origin = this.hoverPreviewOrigin;
		this.hoverPreviewOrigin = null;
		if (!origin) return;

		const scroller = origin.scroller.isConnected ? origin.scroller : this.scroller;
		if (scroller) scroller.scrollTop = origin.scrollTop;
		if (updateActive) this.scheduleActiveUpdate();
	}

	/** Briefly preview an item from the minimap without navigating. */
	private peek(index: number): void {
		if (this.settings.openTrigger === "hover" && !Platform.isMobile) this.open();
		const node = this.headings[index];
		for (const [id, el] of this.rowEls) el.toggleClass("is-peek", id === node?.id);
	}

	open(): void {
		this.cancelClose();
		if (this.isOpen) return;

		// Rebuild fresh so this open reflects the note: completed tasks drop
		// out and any strikes from the previous open are cleared. refresh()
		// also re-validates the tab and re-renders the rows, so neither needs
		// repeating here.
		this.refresh();
		if (flattenAll(this.tree).length === 0) return;

		this.sheetMode = Platform.isMobile;
		this.isOpen = true;
		this.rootEl.addClass("is-open");
		this.rootEl.toggleClass("is-sheet", this.sheetMode);
		this.anchorPopover();
		this.syncActiveRow();
	}


	close(): void {
		if (!this.isOpen) return;
		this.restoreHoverPreview(false);
		this.isOpen = false;
		this.sheetMode = false;
		this.rootEl.removeClass("is-open");
		this.rootEl.removeClass("is-sheet");
		for (const el of this.rowEls.values()) el.removeClass("is-peek");

		// Resync now that we're closed: completed tasks drop from the list and
		// the edge badge count updates.
		this.refresh();
	}

	private currentCache(): CachedMetadata | null {
		const file = this.view.file;
		return file ? this.plugin.app.metadataCache.getFileCache(file) : null;
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	private scheduleClose(): void {
		this.cancelClose();
		this.closeTimer = window.setTimeout(() => this.close(), this.settings.closeDelay);
	}

	private cancelClose(): void {
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
	}
}
