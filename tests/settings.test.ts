import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubtleTocSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS, SubtleTocSettings, TaskStatusKey } from "../src/types";
import {
	FALLBACK_ACTIVE_TAB_BG,
	SAVE_MODE,
	SLIDER_KEYS,
	STATUS_ORDER,
	SettingsControlKey,
	readControl,
	writeControl,
} from "../src/settings-model";

/**
 * The settings tab moved from imperative display() to Obsidian 1.13's
 * declarative API, which means every one of the 27 settings was re-plumbed at
 * once. These tests exist to prove that reorganising the UI did not change
 * what the UI can do: same keys, same defaults, same save behaviour.
 */

type AnyDef = Record<string, any>;

function makePlugin() {
	return {
		settings: structuredClone(DEFAULT_SETTINGS) as SubtleTocSettings,
		saveSettings: vi.fn().mockResolvedValue(undefined),
		saveAndRefresh: vi.fn().mockResolvedValue(undefined),
	};
}

function makeTab() {
	const plugin = makePlugin();
	const tab = new SubtleTocSettingTab({} as never, plugin as never);
	return { tab, plugin };
}

/** Every leaf definition (controls, render rows, label rows), flattened. */
function flatten(items: AnyDef[], out: AnyDef[] = []): AnyDef[] {
	for (const item of items) {
		if (item.type === "group" || item.type === "page") flatten(item.items ?? [], out);
		else out.push(item);
	}
	return out;
}

function controlKeysOf(items: AnyDef[]): string[] {
	return flatten(items)
		.filter((d) => d.control)
		.map((d) => d.control.key as string);
}

describe("definition tree", () => {
	it("puts exactly the seven intended settings on the root page", () => {
		const { tab } = makeTab();
		const root = tab.getSettingDefinitions() as AnyDef[];
		const basic = root.filter((d) => d.type !== "page");

		expect(controlKeysOf(basic)).toEqual([
			"show",
			"outlineMode",
			"side",
			"openTrigger",
			"showMinimap",
			"headerButton",
			"hideMinimapOnPhone",
		]);
	});

	it("puts everything else behind a single Advanced page", () => {
		const { tab } = makeTab();
		const root = tab.getSettingDefinitions() as AnyDef[];
		const pages = root.filter((d) => d.type === "page");

		expect(pages).toHaveLength(1);
		expect(pages[0].name).toBe("Advanced");
		expect(pages[0].items.every((g: AnyDef) => g.type === "group")).toBe(true);
		expect(pages[0].items.map((g: AnyDef) => g.heading)).toEqual([
			"Content",
			"Appearance",
			"Minimap",
			"Behavior",
		]);
	});

	it("exposes every setting that the old UI exposed, and no key twice", () => {
		const { tab } = makeTab();
		const keys = controlKeysOf(tab.getSettingDefinitions() as AnyDef[]);

		expect(new Set(keys).size).toBe(keys.length);

		// The colour row is the one row rendered imperatively, because its
		// reset-to-theme button cannot be expressed as a declarative control.
		// Assert it is really there, so the exemption below cannot rot.
		const colorRow = flatten(tab.getSettingDefinitions() as AnyDef[]).find(
			(d) => d.name === "Active tab color",
		);
		expect(colorRow?.render).toBeTypeOf("function");

		const covered = new Set<string>([...keys, "activeTabBgColor"]);
		// taskStatuses is one array surfaced as eight independent toggles.
		for (const status of STATUS_ORDER) expect(covered.has(`status:${status}`)).toBe(true);
		covered.add("taskStatuses");

		// listMaxDepth was never exposed by the old UI either; it stays a known
		// gap rather than becoming a silent regression of this change.
		const expected = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== "listMaxDepth");
		const missing = expected.filter((k) => !covered.has(k));
		expect(missing).toEqual([]);
	});

	it("keeps Default tab visible only in tabs mode", () => {
		const { tab, plugin } = makeTab();
		const row = flatten(tab.getSettingDefinitions() as AnyDef[]).find(
			(d) => d.name === "Default tab",
		);

		plugin.settings.outlineMode = "unified";
		expect(row?.visible()).toBe(false);
		plugin.settings.outlineMode = "tabs";
		expect(row?.visible()).toBe(true);
	});

	it("gives every slider the same range the old UI offered", () => {
		const { tab } = makeTab();
		const byKey = new Map(
			flatten(tab.getSettingDefinitions() as AnyDef[])
				.filter((d) => d.control?.type === "slider")
				.map((d) => [d.control.key, d.control]),
		);

		expect(byKey.get("minLevel")).toMatchObject({ min: 1, max: 6, step: 1 });
		expect(byKey.get("maxLevel")).toMatchObject({ min: 1, max: 6, step: 1 });
		expect(byKey.get("popoverWidth")).toMatchObject({ min: 160, max: 480, step: 8 });
		expect(byKey.get("minimapWidthScale")).toMatchObject({ min: 50, max: 200, step: 10 });
		expect(byKey.get("minimapVerticalScale")).toMatchObject({ min: 50, max: 200, step: 10 });
		expect(byKey.get("closeDelay")).toMatchObject({ min: 0, max: 1000, step: 20 });
	});

	it("names every dropdown option the same way the old UI did", () => {
		const { tab } = makeTab();
		const byKey = new Map(
			flatten(tab.getSettingDefinitions() as AnyDef[])
				.filter((d) => d.control?.type === "dropdown")
				.map((d) => [d.control.key, d.control.options]),
		);

		expect(byKey.get("show")).toEqual({ both: "Both", headings: "Headings", tasks: "Tasks" });
		expect(byKey.get("outlineMode")).toEqual({
			unified: "Unified tree",
			tabs: "Separate tabs",
		});
		expect(byKey.get("listItems")).toEqual({ none: "None", top: "Top level only", all: "All" });
		expect(byKey.get("side")).toEqual({ right: "Right", left: "Left" });
		expect(byKey.get("openTrigger")).toEqual({ hover: "Hover", click: "Click" });
		expect(byKey.get("headerButton")).toEqual({
			auto: "On mobile only",
			always: "Always",
			never: "Never",
		});
		expect(byKey.get("defaultTab")).toEqual({ headings: "Headings", tasks: "Tasks" });
	});
});

describe("save behaviour is unchanged", () => {
	it("still rebuilds the overlay for everything except the three live-read settings", () => {
		// Inherited verbatim from the imperative tab: these three were the only
		// settings that called saveSettings() instead of saveAndRefresh().
		const saveOnly = Object.entries(SAVE_MODE)
			.filter(([, mode]) => mode === "save")
			.map(([key]) => key)
			.sort();

		expect(saveOnly).toEqual(["closeDelay", "scrollToHeadingOnHover", "smoothScroll"]);
	});

	it("covers every direct control key with a save mode", () => {
		const { tab } = makeTab();
		const keys = controlKeysOf(tab.getSettingDefinitions() as AnyDef[]).filter(
			(k) => !k.startsWith("status:"),
		);
		for (const key of keys) expect(SAVE_MODE).toHaveProperty(key);
	});
});

describe("readControl / writeControl", () => {
	let settings: SubtleTocSettings;
	beforeEach(() => {
		settings = structuredClone(DEFAULT_SETTINGS);
	});

	it("round-trips every boolean, enum and number control", () => {
		const cases: [SettingsControlKey, unknown][] = [
			["show", "tasks"],
			["outlineMode", "tabs"],
			["listItems", "all"],
			["showCallouts", true],
			["stripMarkdown", false],
			["stripTags", true],
			["multiLine", false],
			["showTaskCheckboxes", true],
			["collapsible", false],
			["popoverWidth", 320],
			["defaultTab", "tasks"],
			["showMinimap", false],
			["minimapWidthScale", 150],
			["minimapVerticalScale", 70],
			["showTasksInMinimap", false],
			["side", "left"],
			["openTrigger", "click"],
			["closeDelay", 400],
			["smoothScroll", false],
			["scrollToHeadingOnHover", true],
			["headerButton", "never"],
			["hideMinimapOnPhone", false],
		];

		for (const [key, value] of cases) {
			expect(writeControl(settings, key, value)).not.toBeNull();
			expect(readControl(settings, key)).toBe(value);
		}
	});

	it("shows the theme fallback colour while the colour is unset", () => {
		expect(settings.activeTabBgColor).toBe("");
		expect(readControl(settings, "activeTabBgColor")).toBe(FALLBACK_ACTIVE_TAB_BG);

		writeControl(settings, "activeTabBgColor", "#ff0000");
		expect(readControl(settings, "activeTabBgColor")).toBe("#ff0000");

		// Resetting stores "" so the overlay falls back to the theme.
		writeControl(settings, "activeTabBgColor", "");
		expect(settings.activeTabBgColor).toBe("");
	});

	it("keeps the heading levels from inverting, in both directions", () => {
		settings.minLevel = 1;
		settings.maxLevel = 3;

		writeControl(settings, "minLevel", 5);
		expect(settings).toMatchObject({ minLevel: 5, maxLevel: 5 });

		writeControl(settings, "maxLevel", 2);
		expect(settings).toMatchObject({ minLevel: 2, maxLevel: 2 });
	});

	it("writes task statuses back in canonical order, never insertion order", () => {
		settings.taskStatuses = [];
		for (const key of ["cancelled", "todo", "done"] as TaskStatusKey[]) {
			writeControl(settings, `status:${key}`, true);
		}
		expect(settings.taskStatuses).toEqual(["todo", "done", "cancelled"]);

		writeControl(settings, "status:done", false);
		expect(settings.taskStatuses).toEqual(["todo", "cancelled"]);
	});

	it("ignores values of the wrong type, enum or range instead of storing them", () => {
		const before = structuredClone(settings);

		expect(writeControl(settings, "show", "nonsense")).toBeNull();
		expect(writeControl(settings, "side", 42)).toBeNull();
		expect(writeControl(settings, "showMinimap", "yes")).toBeNull();
		expect(writeControl(settings, "popoverWidth", Number.NaN)).toBeNull();
		expect(writeControl(settings, "status:todo", "true")).toBeNull();

		expect(settings).toEqual(before);

		// Out-of-range numbers are clamped rather than rejected, matching the
		// slider's own limits.
		writeControl(settings, "popoverWidth", 9999);
		expect(settings.popoverWidth).toBe(480);
		writeControl(settings, "closeDelay", -50);
		expect(settings.closeDelay).toBe(0);
	});
});

describe("persistence", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// src/settings.ts debounces through window.setTimeout.
		vi.stubGlobal("window", globalThis);
	});

	it("coalesces a slider drag into a single save and a single rebuild", async () => {
		const { tab, plugin } = makeTab();

		for (let width = 200; width <= 320; width += 8) {
			tab.setControlValue("popoverWidth", width);
		}
		expect(plugin.saveAndRefresh).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(300);
		expect(plugin.saveAndRefresh).toHaveBeenCalledTimes(1);
		expect(plugin.settings.popoverWidth).toBe(320);
	});

	it("writes a toggle immediately, without waiting for the debounce", async () => {
		const { tab, plugin } = makeTab();

		tab.setControlValue("showCallouts", true);
		await vi.advanceTimersByTimeAsync(0);

		expect(plugin.saveAndRefresh).toHaveBeenCalledTimes(1);
		expect(plugin.settings.showCallouts).toBe(true);
	});

	it("does not rebuild the overlay for a live-read setting", async () => {
		const { tab, plugin } = makeTab();

		tab.setControlValue("smoothScroll", false);
		await vi.advanceTimersByTimeAsync(0);

		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
		expect(plugin.saveAndRefresh).not.toHaveBeenCalled();
	});

	it("prefers a rebuild when a debounce window mixes both kinds of write", async () => {
		const { tab, plugin } = makeTab();

		tab.setControlValue("closeDelay", 300); // save-only, debounced
		tab.setControlValue("minLevel", 2); // needs a rebuild, debounced
		await vi.advanceTimersByTimeAsync(300);

		expect(plugin.saveAndRefresh).toHaveBeenCalledTimes(1);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("persists nothing when the value was rejected", async () => {
		const { tab, plugin } = makeTab();

		tab.setControlValue("show", "nonsense");
		await vi.advanceTimersByTimeAsync(300);

		expect(plugin.saveAndRefresh).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
		expect(plugin.settings.show).toBe(DEFAULT_SETTINGS.show);
	});

	it("debounces exactly the controls driven by a slider", () => {
		expect([...SLIDER_KEYS].sort()).toEqual([
			"closeDelay",
			"maxLevel",
			"minLevel",
			"minimapVerticalScale",
			"minimapWidthScale",
			"popoverWidth",
		]);
	});
});

describe("collapse state", () => {
	it("starts collapsed and resets when the settings window closes", () => {
		const { tab } = makeTab();
		const expanded = (tab as unknown as { expanded: Set<string> }).expanded;

		expect(expanded.size).toBe(0);
		expanded.add("content");
		tab.hide();
		expect(expanded.size).toBe(0);
	});
});

describe("defaults are untouched by this change", () => {
	it("still ships the same 27 keys with the same values", () => {
		expect(DEFAULT_SETTINGS).toEqual({
			show: "both",
			defaultTab: "headings",
			showMinimap: true,
			minimapWidthScale: 100,
			minimapVerticalScale: 100,
			showTasksInMinimap: true,
			side: "right",
			openTrigger: "hover",
			closeDelay: 160,
			popoverWidth: 264,
			minLevel: 1,
			maxLevel: 6,
			smoothScroll: true,
			scrollToHeadingOnHover: false,
			showTaskCheckboxes: false,
			activeTabBgColor: "",
			multiLine: true,
			outlineMode: "unified",
			listItems: "none",
			listMaxDepth: 2,
			taskStatuses: ["todo"],
			showCallouts: false,
			stripMarkdown: true,
			stripTags: false,
			collapsible: true,
			headerButton: "auto",
			hideMinimapOnPhone: true,
		});
	});
});
