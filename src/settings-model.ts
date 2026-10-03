import {
	SubtleTocSettings,
	TaskStatusKey,
	TocDefaultTab,
	TocHeaderButton,
	TocListItems,
	TocOutlineMode,
	TocShow,
	TocSide,
	TocTrigger,
} from "./types";

/**
 * The settings model, kept free of any Obsidian import.
 *
 * Obsidian 1.13 renders the settings tab from a data structure rather than
 * from imperative DOM calls, which means the interesting logic -- what a
 * control reads, what writing it does to the rest of the settings, and whether
 * the overlay has to be rebuilt afterwards -- is all plain data. Keeping it
 * here lets the test suite verify it without standing up a mock Obsidian.
 */

/** Only where the picker starts while the color is unset — a neutral gray, since
 *  the theme's own value can be a translucent rgba() the picker can't show. */
export const FALLBACK_ACTIVE_TAB_BG = "#7a7a7a";

/** Statuses offered as toggles, in the order they appear. */
export const STATUS_ORDER: TaskStatusKey[] = [
	"todo",
	"inProgress",
	"done",
	"forwarded",
	"important",
	"question",
	"cancelled",
	"other",
];

/** Keys that map one-to-one onto a field of SubtleTocSettings. */
type DirectControlKey =
	| "show"
	| "outlineMode"
	| "listItems"
	| "showCallouts"
	| "minLevel"
	| "maxLevel"
	| "stripMarkdown"
	| "stripTags"
	| "multiLine"
	| "showTaskCheckboxes"
	| "collapsible"
	| "popoverWidth"
	| "activeTabBgColor"
	| "defaultTab"
	| "showMinimap"
	| "minimapWidthScale"
	| "minimapVerticalScale"
	| "showTasksInMinimap"
	| "side"
	| "openTrigger"
	| "closeDelay"
	| "smoothScroll"
	| "scrollToHeadingOnHover"
	| "headerButton"
	| "hideMinimapOnPhone";

/** `taskStatuses` is one array rendered as eight independent toggles. */
type StatusControlKey = `status:${TaskStatusKey}`;

export type SettingsControlKey = DirectControlKey | StatusControlKey;

/**
 * What has to happen after a write.
 *
 * `refresh` persists and rebuilds the overlay; `save` only persists. The split
 * is inherited verbatim from the imperative settings tab -- close delay,
 * smooth scroll and hover-scroll are read live by the overlay, so rebuilding
 * for them would be wasted work.
 */
export type SaveMode = "refresh" | "save";

export const SAVE_MODE: Record<DirectControlKey, SaveMode> = {
	show: "refresh",
	outlineMode: "refresh",
	listItems: "refresh",
	showCallouts: "refresh",
	minLevel: "refresh",
	maxLevel: "refresh",
	stripMarkdown: "refresh",
	stripTags: "refresh",
	multiLine: "refresh",
	showTaskCheckboxes: "refresh",
	collapsible: "refresh",
	popoverWidth: "refresh",
	activeTabBgColor: "refresh",
	defaultTab: "refresh",
	showMinimap: "refresh",
	minimapWidthScale: "refresh",
	minimapVerticalScale: "refresh",
	showTasksInMinimap: "refresh",
	side: "refresh",
	openTrigger: "refresh",
	closeDelay: "save",
	smoothScroll: "save",
	scrollToHeadingOnHover: "save",
	headerButton: "refresh",
	hideMinimapOnPhone: "refresh",
};

/** Controls driven by a slider, whose writes arrive one per step while dragging. */
export const SLIDER_KEYS: ReadonlySet<SettingsControlKey> = new Set<SettingsControlKey>([
	"minLevel",
	"maxLevel",
	"popoverWidth",
	"minimapWidthScale",
	"minimapVerticalScale",
	"closeDelay",
]);

function isStatusKey(key: SettingsControlKey): key is StatusControlKey {
	return key.startsWith("status:");
}

function statusOf(key: StatusControlKey): TaskStatusKey {
	return key.slice("status:".length) as TaskStatusKey;
}

/** Accepted values for each enum-backed control, so a bad write is ignored. */
const ENUMS: Partial<Record<DirectControlKey, readonly string[]>> = {
	show: ["both", "headings", "tasks"],
	outlineMode: ["unified", "tabs"],
	listItems: ["none", "top", "all"],
	defaultTab: ["headings", "tasks"],
	side: ["right", "left"],
	openTrigger: ["hover", "click"],
	headerButton: ["auto", "always", "never"],
};

/** Inclusive bounds for each slider, matching the ranges the UI offers. */
const RANGES: Partial<Record<DirectControlKey, [number, number]>> = {
	minLevel: [1, 6],
	maxLevel: [1, 6],
	popoverWidth: [160, 480],
	minimapWidthScale: [50, 200],
	minimapVerticalScale: [50, 200],
	closeDelay: [0, 1000],
};

function clamp(value: number, key: DirectControlKey): number {
	const range = RANGES[key];
	if (!range) return value;
	return Math.min(range[1], Math.max(range[0], value));
}

/**
 * Current value of a control.
 *
 * The only value that is not read straight off the settings object is the
 * active tab color, which is stored as "" to mean "follow the theme" but has
 * to hand the color picker something it can actually display.
 */
export function readControl(settings: SubtleTocSettings, key: SettingsControlKey): unknown {
	if (isStatusKey(key)) return settings.taskStatuses.includes(statusOf(key));
	if (key === "activeTabBgColor") return settings.activeTabBgColor || FALLBACK_ACTIVE_TAB_BG;
	return settings[key];
}

/**
 * Apply a control write, returning what the caller must do to persist it.
 *
 * Values that do not match the control's type, enum or range are ignored
 * rather than written, so a malformed value can never corrupt the settings
 * file. The two heading-level sliders push each other apart exactly as they
 * did before, so the range can never invert.
 */
export function writeControl(
	settings: SubtleTocSettings,
	key: SettingsControlKey,
	value: unknown,
): SaveMode | null {
	if (isStatusKey(key)) {
		if (typeof value !== "boolean") return null;
		const status = statusOf(key);
		const set = new Set(settings.taskStatuses);
		if (value) set.add(status);
		else set.delete(status);
		settings.taskStatuses = STATUS_ORDER.filter((k) => set.has(k));
		return "refresh";
	}

	const allowed = ENUMS[key];
	if (allowed) {
		if (typeof value !== "string" || !allowed.includes(value)) return null;
	}

	switch (key) {
		case "show":
			settings.show = value as TocShow;
			break;
		case "outlineMode":
			settings.outlineMode = value as TocOutlineMode;
			break;
		case "listItems":
			settings.listItems = value as TocListItems;
			break;
		case "defaultTab":
			settings.defaultTab = value as TocDefaultTab;
			break;
		case "side":
			settings.side = value as TocSide;
			break;
		case "openTrigger":
			settings.openTrigger = value as TocTrigger;
			break;
		case "headerButton":
			settings.headerButton = value as TocHeaderButton;
			break;

		case "showCallouts":
		case "stripMarkdown":
		case "stripTags":
		case "multiLine":
		case "showTaskCheckboxes":
		case "collapsible":
		case "showMinimap":
		case "showTasksInMinimap":
		case "smoothScroll":
		case "scrollToHeadingOnHover":
		case "hideMinimapOnPhone":
			if (typeof value !== "boolean") return null;
			settings[key] = value;
			break;

		case "minLevel": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			const next = clamp(Math.round(value), "minLevel");
			settings.minLevel = next;
			// Raising the floor above the ceiling pushes the ceiling up with it.
			if (next > settings.maxLevel) settings.maxLevel = next;
			break;
		}
		case "maxLevel": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			const next = clamp(Math.round(value), "maxLevel");
			settings.maxLevel = next;
			if (next < settings.minLevel) settings.minLevel = next;
			break;
		}

		case "popoverWidth":
		case "minimapWidthScale":
		case "minimapVerticalScale":
		case "closeDelay": {
			if (typeof value !== "number" || !Number.isFinite(value)) return null;
			settings[key] = clamp(Math.round(value), key);
			break;
		}

		case "activeTabBgColor": {
			if (typeof value !== "string") return null;
			settings.activeTabBgColor = value;
			break;
		}

		default: {
			// Exhaustiveness guard: adding a key to the union without handling
			// it here is a compile error rather than a silently ignored write.
			const _never: never = key;
			return _never;
		}
	}

	return SAVE_MODE[key];
}
