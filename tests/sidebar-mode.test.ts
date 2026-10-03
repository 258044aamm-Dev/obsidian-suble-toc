import { describe, expect, it } from "vitest";
import {
	VIEW_TYPE_SUBTLE_TOC,
	armSidebar,
	openSidebar,
	toggleSidebar,
} from "../src/sidebar-mode";
import type SubtleTocPlugin from "../src/main";

/**
 * The panel's placement rules, without a DOM or a real workspace.
 *
 * `sidebar-mode.ts` treats the dock and the drawer as one object (both expose
 * `collapsed`/`collapse()`/`expand()`), so these fakes are the whole surface:
 * a dock, a set of leaves, and the workspace's answer to "which leaf is
 * focused". What matters here is that the plugin never places the panel unless
 * it was asked to, and that toggling a panel that is already up puts it away
 * instead of revealing it again.
 */

type Call = [type: string, side: string, options: Record<string, unknown>];

function makePlugin(
	options: {
		side?: "left" | "right";
		collapsed?: boolean;
		withLeaf?: boolean;
		mode?: "off" | "armed" | "open";
	} = {},
) {
	const { side = "right", collapsed = true, withLeaf = false, mode = "off" } = options;
	const calls: Call[] = [];
	const leaf = { id: `${side}:${VIEW_TYPE_SUBTLE_TOC}`, view: {} };

	const makeDock = () => ({
		collapsed,
		collapse() {
			this.collapsed = true;
		},
		expand() {
			this.collapsed = false;
		},
	});
	const leftSplit = makeDock();
	const rightSplit = makeDock();

	const app = {
		workspace: {
			leftSplit,
			rightSplit,
			activeLeaf: withLeaf ? leaf : { id: "markdown" },
			getLeavesOfType: (type: string) => (withLeaf && type === VIEW_TYPE_SUBTLE_TOC ? [leaf] : []),
			ensureSideLeaf: async (
				type: string,
				side2: string,
				opts: Record<string, unknown> = {},
			) => {
				calls.push([type, side2, opts]);
				return leaf;
			},
		},
	};

		const plugin = { app, settings: { sidebarSide: side, sidebarMode: mode } };
	return {
		plugin: plugin as unknown as SubtleTocPlugin,
		app,
		leaf,
		calls,
		dock: side === "left" ? leftSplit : rightSplit,
		otherDock: side === "left" ? rightSplit : leftSplit,
	};
}

describe("opening the panel", () => {
	it("asks for the view in the configured dock, focused and revealed", async () => {
		const { plugin, calls } = makePlugin();
		await openSidebar(plugin);

		expect(calls).toEqual([[VIEW_TYPE_SUBTLE_TOC, "right", { active: true, reveal: true }]]);
	});

	it("follows the side setting", async () => {
		const { plugin, calls, otherDock } = makePlugin({ side: "left" });
		await openSidebar(plugin);

		expect(calls[0][1]).toBe("left");
		expect(otherDock.collapsed).toBe(true);
	});
});

describe("arming the panel at startup", () => {
	it("does nothing at all when the mode is off", async () => {
		const { plugin, calls, dock } = makePlugin({ mode: "off" });
		await armSidebar(plugin);

		expect(calls).toEqual([]);
		expect(dock.collapsed).toBe(true);
	});

	it("makes the panel the dock's active tab without revealing it", async () => {
		// This is what puts the panel behind Obsidian's own swipe: the gesture
		// opens whatever the drawer last showed. Revealing it here would pop the
		// drawer open at startup, uninvited.
		const { plugin, calls, dock } = makePlugin({ mode: "armed" });
		await armSidebar(plugin);

		expect(calls).toEqual([[VIEW_TYPE_SUBTLE_TOC, "right", { active: true, reveal: false }]]);
		expect(dock.collapsed).toBe(true);
	});

	it("reveals the dock too when the mode says open", async () => {
		const { plugin, calls } = makePlugin({ mode: "open" });
		await armSidebar(plugin);

		expect(calls[0][2]).toMatchObject({ active: true, reveal: true });
	});

	it("arms into the configured side", async () => {
		const { plugin, calls } = makePlugin({ mode: "armed", side: "left" });
		await armSidebar(plugin);

		expect(calls[0][1]).toBe("left");
	});
});

describe("toggling the panel", () => {
	it("opens when there is no panel yet", async () => {
		const { plugin, calls } = makePlugin();
		await toggleSidebar(plugin);

		expect(calls).toHaveLength(1);
		expect(calls[0][2]).toMatchObject({ reveal: true });
	});

	it("puts the dock away when the panel is up and focused", async () => {
		const { plugin, calls, dock } = makePlugin({
			collapsed: false,
			withLeaf: true,
		});
		await toggleSidebar(plugin);

		expect(calls).toEqual([]);
		expect(dock.collapsed).toBe(true);
	});

	it("reveals instead of collapsing when the note has focus", async () => {
		// The dock is open but the user is in the note: the command must bring
		// the panel up, not hide a panel they were not looking at.
		const { plugin, calls, dock } = makePlugin({
			collapsed: false,
			withLeaf: true,
		});
		plugin.app.workspace.activeLeaf = { id: "markdown" };
		await toggleSidebar(plugin);

		expect(calls).toHaveLength(1);
		expect(dock.collapsed).toBe(false);
	});

	it("reveals when the panel is hidden behind a collapsed dock", async () => {
		const { plugin, calls } = makePlugin({ collapsed: true, withLeaf: true });
		await toggleSidebar(plugin);

		expect(calls).toHaveLength(1);
	});
});
