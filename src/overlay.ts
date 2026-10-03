import { MarkdownView, Platform } from "obsidian";
import { OutlineNode } from "./types";
import { OutlineTreeRenderer, TreeCallbacks } from "./tree";
import { createCheckboxIcon, createCloseIcon } from "./icons";
import type SubtleTocPlugin from "./main";

/** Extra hierarchy spread applied only to minimap widths above 100%. */
const MINIMAP_HIERARCHY_SPREAD = 0.5;

/**
 * The floating TOC of a single MarkdownView: the edge strip, the minimap, the
 * task badge, the popover/sheet chrome and the note-header button.
 *
 * The outline itself — tabs, rows, folding, completion, active tracking — lives
 * in `OutlineTreeRenderer`, which the sidebar view hosts as well. This class
 * owns everything about *where* the outline floats and nothing about what is in
 * it.
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
	/** The note-header action button, when one is installed. */
	private headerButtonEl: HTMLElement | null = null;

	private renderer: OutlineTreeRenderer;
	private dashEls: HTMLElement[] = [];
	private isOpen = false;
	/** True when the popover is showing as a mobile sheet. */
	private sheetMode = false;

	private closeTimer: number | null = null;
	/** Scroll position to restore when hover preview ends without a click. */
	private hoverPreviewOrigin: { scroller: HTMLElement; scrollTop: number } | null = null;
	/** Deferred restore lets the pointer cross directly between heading rows. */
	private hoverPreviewRestoreFrame: number | null = null;

	constructor(plugin: SubtleTocPlugin, view: MarkdownView) {
		this.plugin = plugin;
		this.view = view;
		const callbacks: TreeCallbacks = {
			// The dashes mirror the list's active heading, and the hover preview
			// hooks only make sense while the popover is the thing on screen.
			onActiveChange: (index) => this.setActiveDash(index),
			onTabChange: (tab) => {
				if (tab !== "headings") this.restoreHoverPreview();
			},
			onTaskCountChange: (open) => this.buildTaskBadge(open),
			onRowHover: (node) => this.previewOnHover(node),
			onRowLeave: () => this.scheduleHoverPreviewRestore(),
			onNavigateStart: () => this.commitHoverPreview(),
			// A tap on a phone should hand the note back immediately.
			onNavigated: () => {
				if (this.sheetMode) this.close();
			},
			isSurfaceVisible: () => this.isOpen,
			canAutoScrollActive: () => this.isOpen,
		};
		this.renderer = new OutlineTreeRenderer({
			plugin,
			getView: () => this.view,
			callbacks,
		});
	}

	private get settings() {
		return this.plugin.settings;
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

		// The tree's mode/tab classes go on the root, where the popover and
		// sheet rules expect them. Mounted first: the sheet's close button is
		// appended to the tab bar the tree builds.
		this.renderer.mount(this.popoverEl, this.rootEl);
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

		// Still the popover: the sidebar has its own command and its own tab.
		this.headerButtonEl = this.view.addAction("list", "Open outline", () => this.toggle());
		this.headerButtonEl.addClass("subtle-toc-header-button");
	}

	private removeHeaderButton(): void {
		this.headerButtonEl?.remove();
		this.headerButtonEl = null;
	}

	unmount(): void {
		this.restoreHoverPreview(false);
		if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
		this.cancelHoverPreviewRestore();
		this.removeHeaderButton();
		this.renderer.destroy();
		this.rootEl?.remove();
		this.view.contentEl.removeClass("subtle-toc-host");
	}

	// ---- DOM construction --------------------------------------------------

	private buildPopoverChrome(): void {
		// Only the sheet shows a close affordance; on desktop the popover still
		// closes by moving the pointer away.
		const close = this.renderer.tabBar.createDiv({ cls: "subtle-toc-close" });
		createCloseIcon(close);
		close.setAttribute("aria-label", "Close outline");
		close.addEventListener("pointerdown", (e) => e.preventDefault());
		close.addEventListener("click", (e) => {
			e.stopPropagation();
			this.close();
		});
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

	/** Phone/desktop layout class; the tree's own mode classes live on the
	 *  renderer's state host (this same root). */
	private applyModes(): void {
		this.rootEl.toggleClass("is-phone", this.isPhone);
		this.rootEl.toggleClass("is-mobile", Platform.isMobile);
	}

	// ---- data refresh ------------------------------------------------------

	/** Re-read the note from the metadata cache and rebuild everything. */
	refresh(): void {
		// Rebuilding the list removes its hover listeners, so finish any preview
		// before replacing the rows.
		this.restoreHoverPreview(false);
		this.applySide();
		this.applyColors();
		this.applyPopoverWidth();
		this.applyMinimapSizing();
		this.applyModes();

		this.renderer.refresh();

		const headings = this.renderer.headingsAll;
		const hasHeadings = headings.length > 0;
		// Dashes honor the "show minimap" toggle; on a phone the strip is too
		// narrow to tap, so the header button stands in for it entirely.
		const minimapAllowed =
			this.settings.showMinimap && !(this.isPhone && this.settings.hideMinimapOnPhone);
		this.minimapEl.toggleClass("is-hidden", !minimapAllowed || !hasHeadings);
		this.rootEl.toggleClass("is-empty", this.renderer.isEmpty);

		this.refreshTaskChrome(minimapAllowed);
		this.buildMinimap();

		if (this.renderer.isEmpty) this.close();
	}

	/** Update the edge badge from the current tree (the tab count is the
	 *  renderer's own). */
	private refreshTaskChrome(minimapAllowed: boolean): void {
		const open = this.renderer.openTaskCount;

		// With no headings the badge is the only way to open the popover, so the
		// toggle only suppresses it while the dashes can stand in as the trigger.
		const suppressed =
			!this.settings.showTasksInMinimap && this.renderer.headingsAll.length > 0;
		this.taskBadgeEl.toggleClass(
			"is-hidden",
			!minimapAllowed || open === 0 || suppressed,
		);
		this.buildTaskBadge(open);
	}

	private buildMinimap(): void {
		this.minimapEl.empty();
		this.dashEls = this.renderer.headingsAll.map((h, i) => {
			const dash = this.minimapEl.createDiv({
				cls: `subtle-toc-dash subtle-toc-level-${h.rawLevel}`,
			});
			dash.setAttribute("aria-label", h.text);
			dash.addEventListener("click", (e) => {
				e.stopPropagation();
				this.renderer.navigate(h);
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

	// ---- active heading tracking -------------------------------------------

	/** The minimap mirrors the list's active heading. */
	private setActiveDash(next: number): void {
		for (const dash of this.dashEls) dash.removeClass("is-active");
		if (next >= 0) this.dashEls[next]?.addClass("is-active");
	}

	// ---- interactions ------------------------------------------------------

	/** Temporarily show a hovered row without moving the editor cursor or
	 *  flashing it. Leaving the rows restores the original viewport. */
	private previewOnHover(node: OutlineNode): void {
		if (!this.settings.scrollToHeadingOnHover) return;
		if (node.kind !== "heading") return;
		this.cancelHoverPreviewRestore();
		const scroller = this.renderer.scrollerEl;
		if (!this.hoverPreviewOrigin && scroller) {
			this.hoverPreviewOrigin = { scroller, scrollTop: scroller.scrollTop };
		}
		this.renderer.previewHeading(node);
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

		const scroller = origin.scroller.isConnected
			? origin.scroller
			: this.renderer.scrollerEl;
		if (scroller) scroller.scrollTop = origin.scrollTop;
		// Put the highlight back where the note actually is.
		if (updateActive) this.renderer.scheduleActiveUpdate();
	}

	/** Briefly preview an item from the minimap without navigating. */
	private peek(index: number): void {
		if (this.settings.openTrigger === "hover" && !Platform.isMobile) this.open();
		this.renderer.setPeek(index);
	}

	open(): void {
		this.cancelClose();
		if (this.isOpen) return;

		// Rebuild fresh so this open reflects the note: completed tasks drop
		// out and any strikes from the previous open are cleared. refresh()
		// also re-validates the tab and re-renders the rows, so neither needs
		// repeating here.
		this.refresh();
		if (this.renderer.isEmpty) return;

		this.sheetMode = Platform.isMobile;
		this.isOpen = true;
		this.rootEl.addClass("is-open");
		this.rootEl.toggleClass("is-sheet", this.sheetMode);
		this.anchorPopover();
		this.renderer.syncActiveRow();
	}

	close(): void {
		if (!this.isOpen) return;
		this.restoreHoverPreview(false);
		this.isOpen = false;
		this.sheetMode = false;
		this.rootEl.removeClass("is-open");
		this.rootEl.removeClass("is-sheet");
		this.renderer.clearPeek();

		// Resync now that we're closed: completed tasks drop from the list and
		// the edge badge count updates.
		this.refresh();
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
