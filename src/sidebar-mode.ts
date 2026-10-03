import { App, WorkspaceLeaf } from "obsidian";
import type SubtleTocPlugin from "./main";

/**
 * The sidebar/drawer surface, and the four operations the plugin performs on
 * it: arm it (Stage 3), open it, toggle it, and find it.
 *
 * Keeping this out of `sidebar.ts` means the view file is about the view, and
 * the placement questions — which dock, revealed or not, is it already up —
 * are answerable without instantiating anything.
 */

export const VIEW_TYPE_SUBTLE_TOC = "subtle-toc-sidebar";

/**
 * The dock or drawer the view lives in.
 *
 * `leftSplit`/`rightSplit` are typed as `WorkspaceSidedock | WorkspaceMobileDrawer`,
 * and the two share `collapsed`, `expand()` and `collapse()` — so the same code
 * drives the desktop dock and the phone drawer with no cast and no branch.
 */
function sideDock(plugin: SubtleTocPlugin) {
	return plugin.settings.sidebarSide === "left"
		? plugin.app.workspace.leftSplit
		: plugin.app.workspace.rightSplit;
}

/** Leaves currently holding the view (normally zero or one). */
function sidebarLeaves(app: App): WorkspaceLeaf[] {
	return app.workspace.getLeavesOfType(VIEW_TYPE_SUBTLE_TOC);
}

/**
 * Whether the view is up *and* on screen: a leaf in the configured dock, in a
 * dock that is not collapsed, and the focused leaf in it.
 *
 * `activeLeaf` is deprecated, and used here on purpose. The recommended
 * alternative, `getActiveViewOfType(MarkdownView)`, answers `null` exactly when
 * the panel has focus — the case this function exists to detect — and nothing
 * on `WorkspaceSidedock`, `WorkspaceTabs` or `WorkspaceLeaf` exposes which tab
 * of a dock is showing. The field still exists and is `@public`; a false
 * negative here only makes the toggle reveal an already-visible panel.
 */
function sidebarIsVisible(plugin: SubtleTocPlugin): boolean {
	if (sideDock(plugin).collapsed) return false;
	const activeLeaf = plugin.app.workspace.activeLeaf;
	if (!activeLeaf) return false;
	return sidebarLeaves(plugin.app).some((leaf) => leaf === activeLeaf);
}

/** Open (or reveal) the view in its dock and focus it. */
export async function openSidebar(plugin: SubtleTocPlugin): Promise<void> {
	await plugin.app.workspace.ensureSideLeaf(VIEW_TYPE_SUBTLE_TOC, plugin.settings.sidebarSide, {
		active: true,
		reveal: true,
	});
}

/** Reveal the view, or put the dock away if it is already the one on screen. */
export async function toggleSidebar(plugin: SubtleTocPlugin): Promise<void> {
	if (sidebarIsVisible(plugin)) {
		sideDock(plugin).collapse();
		return;
	}
	await openSidebar(plugin);
}
