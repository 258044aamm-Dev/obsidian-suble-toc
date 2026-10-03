import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { OutlineTreeRenderer, TreeCallbacks } from "./tree";
import { VIEW_TYPE_SUBTLE_TOC } from "./sidebar-mode";
import type SubtleTocPlugin from "./main";

/**
 * Subtle TOC as a panel: the right dock on desktop, the drawer on a phone.
 *
 * This is a *view of its own*, not a replacement for Obsidian's panes — the
 * core Outline and Backlinks tabs are untouched, and this one sits beside them.
 * It hosts the same `OutlineTreeRenderer` the floating overlay does, so the
 * rows are the same rows by construction: folding, task checkboxes, statuses,
 * multi-line wrapping, level range and every strip option apply here because
 * they apply there.
 *
 * What deliberately does not come along is the overlay's chrome and its hover
 * behaviour: no minimap, no edge badge, no sheet, and no scroll-on-hover — a
 * temporary scroll that restores on pointer-leave makes no sense in a panel
 * the user is reading from.
 */
export class SubtleTocSidebarView extends ItemView {
	private plugin: SubtleTocPlugin;
	private renderer: OutlineTreeRenderer | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SubtleTocPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_SUBTLE_TOC;
	}

	getDisplayText(): string {
		return "Subtle TOC";
	}

	getIcon(): string {
		return "list";
	}

	/** Obsidian calls this once the view is attached to its leaf. */
	async onOpen(): Promise<void> {
		const container = this.contentEl.createDiv({ cls: "subtle-toc-sidebar" });

		const callbacks: TreeCallbacks = {
			// A panel is always on screen, so the active row is kept in view and
			// the tab is corrected on refresh whenever the note cannot fill it.
			canAutoScrollActive: () => true,
		};
		this.renderer = new OutlineTreeRenderer({
			plugin: this.plugin,
			getView: () => this.plugin.noteView,
			callbacks,
		});
		this.renderer.mount(container);
		this.refresh();

		// Registered on the view, so Obsidian unregisters them with it.
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
		this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
		this.registerEvent(
			this.app.workspace.on("file-open", (file: TFile | null) => {
				if (!file || file === this.currentFile()) this.refresh();
			}),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (file === this.currentFile()) this.refresh();
			}),
		);
	}

	async onClose(): Promise<void> {
		this.renderer?.destroy();
		this.renderer = null;
	}

	/** Rebuild from the note. Called by the plugin when settings change. */
	refresh(): void {
		this.renderer?.refresh();
	}

	/** The file the panel is describing, for change filtering. */
	private currentFile(): TFile | null {
		return this.plugin.noteView?.file ?? null;
	}
}
