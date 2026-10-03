import { MarkdownView, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, SubtleTocSettings } from "./types";
import { TocOverlay } from "./overlay";
import { SubtleTocSidebarView } from "./sidebar";
import { VIEW_TYPE_SUBTLE_TOC, openSidebar, toggleSidebar } from "./sidebar-mode";
import { SubtleTocSettingTab } from "./settings";

export default class SubtleTocPlugin extends Plugin {
	settings!: SubtleTocSettings;
	private overlay: TocOverlay | null = null;
	/**
	 * The most recent note view.
	 *
	 * The sidebar/drawer takes focus when it is used, and
	 * `getActiveViewOfType(MarkdownView)` is then null — a sidebar that asked
	 * the workspace for "the active note" would be empty exactly when it is
	 * tapped. The overlay can ask directly, because it only ever lives inside a
	 * note.
	 */
	private lastNoteView: MarkdownView | null = null;

	/** The note the sidebar should describe. */
	get noteView(): MarkdownView | null {
		return this.lastNoteView ?? this.app.workspace.getActiveViewOfType(MarkdownView);
	}

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new SubtleTocSettingTab(this.app, this));

		// Must happen in onload: a workspace with the view already open rebuilds
		// it from its saved state at startup, and an unregistered type is dropped.
		this.registerView(VIEW_TYPE_SUBTLE_TOC, (leaf) => new SubtleTocSidebarView(leaf, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.sync()),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.sync()),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (this.overlay && this.overlay.view.file === file) {
					this.overlay.refresh();
				}
			}),
		);

		this.addCommand({
			id: "toggle-toc-popover",
			name: "Toggle TOC popover",
			callback: () => this.overlay?.toggle(),
		});
		// The deliberate way in. The note-header button keeps toggling the
		// popover: silently repointing an existing affordance would be a
		// surprise, and on desktop the dock's own tab is right there.
		this.addCommand({
			id: "open-toc-sidebar",
			name: "Open in sidebar",
			callback: () => void openSidebar(this),
		});
		this.addCommand({
			id: "toggle-toc-sidebar",
			name: "Toggle sidebar view",
			callback: () => void toggleSidebar(this),
		});

		this.app.workspace.onLayoutReady(() => this.sync());
	}

	onunload(): void {
		this.teardownOverlay();
	}

	/** Ensure exactly one overlay exists, bound to the active markdown view. */
	private sync(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (view) this.lastNoteView = view;
		// The tracked note can be closed while the sidebar holds focus, and a
		// detached view still answers getViewData() with its last text.
		else if (this.lastNoteView && !this.noteIsOpen(this.lastNoteView)) {
			this.lastNoteView = null;
		}

		if (this.overlay && this.overlay.view !== view) {
			this.teardownOverlay();
		}

		if (!view) return;

		if (!this.overlay) {
			this.overlay = new TocOverlay(this, view);
			this.overlay.mount();
		}
		this.overlay.refresh();
	}

	/** Whether a tracked note view is still one of the workspace's markdown leaves. */
	private noteIsOpen(view: MarkdownView): boolean {
		return this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === view);
	}

	private teardownOverlay(): void {
		this.overlay?.unmount();
		this.overlay = null;
	}

	/** Rebuild the overlay from scratch so option changes take full effect. */
	private rebuildOverlay(): void {
		this.teardownOverlay();
		this.sync();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Persist settings and re-apply them (used by settings that change layout). */
	async saveAndRefresh(): Promise<void> {
		await this.saveSettings();
		this.rebuildOverlay();
		// The panel is a second surface onto the same settings; both follow.
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_SUBTLE_TOC)) {
			if (leaf.view instanceof SubtleTocSidebarView) leaf.view.refresh();
		}
	}
}
