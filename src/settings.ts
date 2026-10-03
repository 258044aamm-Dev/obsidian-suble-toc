import {
	App,
	ExtraButtonComponent,
	PluginSettingTab,
	Setting,
	SettingDefinition,
	SettingDefinitionGroup,
	SettingDefinitionItem,
	SettingGroup,
	SettingGroupItem,
} from "obsidian";
import { STATUS_LABELS } from "./outline";
import {
	FALLBACK_ACTIVE_TAB_BG,
	SaveMode,
	SettingsControlKey,
	SLIDER_KEYS,
	STATUS_ORDER,
	readControl,
	writeControl,
} from "./settings-model";
import type SubtleTocPlugin from "./main";

/**
 * Debounce writes that a slider fires continuously.
 *
 * Dragging a slider emits an event per step, and each one would otherwise
 * write settings to disk and rebuild the entire overlay — roughly sixteen of
 * each for one sweep of the minimap width slider.
 */
function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
	let timer: number | null = null;
	return (...args: T) => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			fn(...args);
		}, ms);
	};
}

/** Groups on the advanced page, in render order. Ids are used for collapse state. */
const GROUPS = ["content", "appearance", "minimap", "behavior"] as const;
type GroupId = (typeof GROUPS)[number];

const GROUP_LABELS: Record<GroupId, string> = {
	content: "Content",
	appearance: "Appearance",
	minimap: "Minimap",
	behavior: "Behavior",
};

/**
 * One line per group saying what is inside it, drawn under the group title.
 *
 * Kept beside the labels so a group's title and its description are declared
 * together, and mirrored into the definition's `desc` -- see headerRow.
 */
const GROUP_DESCRIPTIONS: Record<GroupId, string> = {
	content: "Bullets, callouts, task statuses, heading levels.",
	appearance: "Text clean-up, wrapping, folding, popover width.",
	minimap: "Marker size and spacing, task count on the edge.",
	behavior: "Close delay, smooth scroll, hover preview.",
};

/**
 * The settings tab.
 *
 * Built on the declarative API Obsidian 1.13 introduced: `getSettingDefinitions()`
 * returns the whole tab as data and the framework renders it, which is why there
 * is no `display()` here. Returning a non-empty array makes the framework bypass
 * `display()` entirely, so this is all-or-nothing — there is no half-migrated
 * state in which some rows render imperatively.
 *
 * Shape: the handful of settings most people actually touch sit on the root
 * page, and everything else lives behind a single "Advanced" entry that opens a
 * sub-page of collapsible groups.
 */
export class SubtleTocSettingTab extends PluginSettingTab {
	plugin: SubtleTocPlugin;

	/**
	 * Groups the user has opened, by id.
	 *
	 * Deliberately not persisted: every group starts collapsed, and the set is
	 * cleared in hide(), so closing the settings window — or the app — returns
	 * the page to its collapsed state. Keeping it out of data.json also means
	 * no new setting key and no migration.
	 */
	private readonly expanded = new Set<GroupId>();

	/** Coalesced across a debounce window; "refresh" wins over "save". */
	private pendingMode: SaveMode | null = null;

	constructor(app: App, plugin: SubtleTocPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.expanded.clear();
		super.hide();
	}

	// ---- value plumbing ----------------------------------------------------

	getControlValue(key: string): unknown {
		return readControl(this.plugin.settings, key as SettingsControlKey);
	}

	setControlValue(key: string, value: unknown): void {
		const controlKey = key as SettingsControlKey;
		const mode = writeControl(this.plugin.settings, controlKey, value);
		// null means the value failed validation and nothing was written.
		if (mode === null) return;
		this.queue(mode, SLIDER_KEYS.has(controlKey));
	}

	private queue(mode: SaveMode, debounced: boolean): void {
		this.pendingMode = this.pendingMode === "refresh" ? "refresh" : mode;
		if (debounced) this.commitDebounced();
		else void this.flush();
	}

	private async flush(): Promise<void> {
		const mode = this.pendingMode;
		this.pendingMode = null;
		if (mode === "refresh") await this.plugin.saveAndRefresh();
		else if (mode === "save") await this.plugin.saveSettings();
	}

	private readonly commitDebounced = debounce(() => {
		void this.flush();
	}, 250);

	// ---- collapsing --------------------------------------------------------

	/**
	 * The row that opens and closes a group.
	 *
	 * Rendered imperatively so that it is an ordinary `.setting-item` — the
	 * same markup Obsidian gives the "Advanced" navigation row. The group's
	 * declarative `heading` field was used here first, but that is the
	 * section-heading primitive: larger, bolder and spaced as a divider, so it
	 * read as a stack of titles rather than a list of rows.
	 *
	 * `desc` mirrors the line the row draws under its title, so the definition
	 * and the row stay one source of truth. It is not written into the
	 * framework's own description box: wireHeaderRow draws the row itself.
	 */
	private headerRow(id: GroupId): SettingDefinition {
		return {
			name: GROUP_LABELS[id],
			desc: GROUP_DESCRIPTIONS[id],
			// An affordance rather than a setting, so keep it out of search.
			searchable: false,
			render: (setting, group) => this.wireHeaderRow(setting, group, id),
		};
	}

	/**
	 * Make a header row collapse its group.
	 *
	 * `settingEl` is the row and `listEl` is the container holding the group's
	 * items; both are handed over by the API, so unlike the first attempt there
	 * is no walking up the DOM guessing which ancestor is which.
	 *
	 * The row's interior is built here rather than left to the framework. A
	 * settings row is laid out by Obsidian — horizontally on desktop, as a
	 * column on mobile, and only the framework knows which — and the two slots
	 * it offers for content (`infoEl`, `controlEl`) are siblings, so whatever
	 * the host does to lay the row out decides where the caret ends up. That is
	 * how the caret came to sit under the title, flush left, and why restating
	 * the row's `flex-direction` kept failing: it was a correction to a layout
	 * owned by someone else, applied by guesswork.
	 *
	 * So the row is given one child of our own — title and description, then
	 * the caret — and that child lays itself out. The host now has a single box
	 * to place, and no direction it can stack in can separate the title from
	 * the caret.
	 */
	private wireHeaderRow(setting: Setting, group: SettingGroup | undefined, id: GroupId): void {
		const rowEl = setting.settingEl;
		const listEl = group?.listEl;

		rowEl.addClass("subtle-toc-settings-group-header");

		// The framework may render the same row more than once; keep one
		// interior rather than stacking title/description/caret per render.
		rowEl.querySelector<HTMLElement>(".subtle-toc-settings-group-head")?.remove();

		const headEl = rowEl.createDiv({ cls: "subtle-toc-settings-group-head" });
		const textEl = headEl.createDiv({ cls: "subtle-toc-settings-group-text" });
		textEl.createDiv({ cls: "subtle-toc-settings-group-title", text: GROUP_LABELS[id] });
		textEl.createDiv({ cls: "subtle-toc-settings-group-desc", text: GROUP_DESCRIPTIONS[id] });
		// The caret slot. Obsidian's own extra button is moved into it below;
		// nothing is written into the framework's info/control boxes at all
		// (styles.css takes them out of the layout), so all three of the row's
		// visible parts live in the one child above.
		const caretEl = headEl.createDiv({ cls: "subtle-toc-settings-group-caret" });

		if (!listEl) {
			// Nothing to scope the hide to. Leave the group open rather than
			// risk hiding rows, or hiding the header and sealing it shut.
			this.expanded.add(id);
			return;
		}

		listEl.addClass("subtle-toc-settings-group-list");
		if (!listEl.id) listEl.id = `subtle-toc-settings-group-${id}`;
		rowEl.setAttribute("role", "button");
		rowEl.setAttribute("aria-controls", listEl.id);
		rowEl.tabIndex = 0;

		let chevron: ExtraButtonComponent | null = null;

		const apply = () => {
			const open = this.expanded.has(id);
			chevron?.setIcon(open ? "chevron-down" : "chevron-right");
			chevron?.setTooltip(open ? "Collapse" : "Expand");
			rowEl.setAttribute("aria-expanded", open ? "true" : "false");
			rowEl.toggleClass("is-expanded", open);
			listEl.toggleClass("is-collapsed", !open);
		};

		const toggle = () => {
			if (this.expanded.has(id)) this.expanded.delete(id);
			else this.expanded.add(id);
			apply();
		};

		setting.addExtraButton((b) => {
			chevron = b;
			b.onClick(toggle);
			// Obsidian's own button, moved into the slot this row owns. Its
			// click handler, tooltip and teardown stay the framework's; only
			// its position is ours. (addExtraButton appends it to the row's
			// control box first, which styles.css hides.)
			caretEl.appendChild(b.extraSettingsEl);
		});

		rowEl.addEventListener("click", (ev) => {
			// The chevron has its own handler; letting both run toggles twice
			// and the row looks dead.
			const icon = chevron?.extraSettingsEl;
			if (icon && ev.target instanceof Node && icon.contains(ev.target)) return;
			toggle();
		});

		rowEl.addEventListener("keydown", (ev) => {
			if (ev.key !== "Enter" && ev.key !== " ") return;
			ev.preventDefault();
			toggle();
		});

		apply();
	}

	private group(id: GroupId, items: SettingGroupItem[]): SettingDefinitionGroup {
		return {
			type: "group",
			// No `heading`: the first item is the header row instead.
			cls: `subtle-toc-settings-group subtle-toc-settings-group--${id}`,
			items: [this.headerRow(id), ...items],
		};
	}

	// ---- definitions -------------------------------------------------------

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [...this.basicItems(), this.advancedPage()];
	}

	/**
	 * The root page: the settings worth deciding once, on the way in.
	 *
	 * Short enough that collapsing it would cost a click to see seven rows,
	 * which is why only the advanced page has collapsible groups.
	 */
	private basicItems(): SettingDefinitionItem[] {
		return [
			{
				name: "Show",
				desc: "Which content to surface: headings, open tasks, or both.",
				control: {
					type: "dropdown",
					key: "show",
					options: { both: "Both", headings: "Headings", tasks: "Tasks" },
				},
			},
			{
				name: "Outline mode",
				desc: "Unified shows one nested tree with tasks and lists under their heading. Separate tabs keeps the original Headings and Tasks split.",
				aliases: ["tree", "tabs"],
				control: {
					type: "dropdown",
					key: "outlineMode",
					options: { unified: "Unified tree", tabs: "Separate tabs" },
				},
			},
			{
				name: "Side",
				desc: "Which edge of the note to dock the TOC on.",
				aliases: ["left", "right"],
				control: {
					type: "dropdown",
					key: "side",
					options: { right: "Right", left: "Left" },
				},
			},
			{
				name: "Open the popover on",
				desc: "Hover over the minimap, or require a click to open. Touch always taps.",
				aliases: ["hover", "click", "trigger"],
				control: {
					type: "dropdown",
					key: "openTrigger",
					options: { hover: "Hover", click: "Click" },
				},
			},
			{
				name: "Show minimap",
				desc: "Show the dashed markers along the edge of the note.",
				aliases: ["markers", "dashes"],
				control: { type: "toggle", key: "showMinimap" },
			},
			{
				name: "Note header button",
				desc: "Add a button to the note header that opens the outline. On a phone the edge markers are too narrow to tap, so this is the way in.",
				aliases: ["mobile", "phone", "toolbar"],
				control: {
					type: "dropdown",
					key: "headerButton",
					options: { auto: "On mobile only", always: "Always", never: "Never" },
				},
			},
			{
				name: "Hide minimap on phones",
				desc: "Hide the dashed edge markers on phone-sized screens, where they are too narrow to hit reliably. Tablets keep them.",
				aliases: ["mobile", "phone"],
				control: { type: "toggle", key: "hideMinimapOnPhone" },
			},
		];
	}

	private advancedPage(): SettingDefinitionItem {
		return {
			type: "page",
			name: "Advanced",
			desc: "Content filters, text clean-up, minimap size and popover behavior.",
			items: [
				this.group("content", this.contentItems()),
				this.group("appearance", this.appearanceItems()),
				this.group("minimap", this.minimapItems()),
				this.group("behavior", this.behaviorItems()),
			],
		};
	}

	private contentItems(): SettingGroupItem[] {
		return [
			{
				name: "List items",
				desc: "Include plain bullets and numbered items, not just checkboxes. Long notes can produce a lot of rows, so this starts off.",
				aliases: ["bullets", "numbered"],
				control: {
					type: "dropdown",
					key: "listItems",
					options: { none: "None", top: "Top level only", all: "All" },
				},
			},
			{
				name: "Callouts",
				desc: "Include callout headers, such as a note or warning title, as outline rows.",
				control: { type: "toggle", key: "showCallouts" },
			},
			{
				name: "Task statuses",
				desc: "Which checkbox statuses appear in the outline. Only an unchecked task can be completed from the popover.",
				aliases: ["checkbox", "done", "cancelled"],
			},
			...STATUS_ORDER.map((key) => ({
				name: STATUS_LABELS[key],
				aliases: ["task status"],
				control: { type: "toggle" as const, key: `status:${key}` },
			})),
			{
				name: "Minimum heading level",
				desc: "Lowest heading level to show (1 = H1).",
				aliases: ["h1", "level"],
				control: { type: "slider", key: "minLevel", min: 1, max: 6, step: 1 },
			},
			{
				name: "Maximum heading level",
				desc: "Highest heading level to show (6 = H6).",
				aliases: ["h6", "level"],
				control: { type: "slider", key: "maxLevel", min: 1, max: 6, step: 1 },
			},
		];
	}

	private appearanceItems(): SettingGroupItem[] {
		return [
			{
				name: "Clean up Markdown",
				desc: "Show heading and task text as a reader would see it, resolving links and removing formatting marks.",
				aliases: ["strip", "formatting", "links"],
				control: { type: "toggle", key: "stripMarkdown" },
			},
			{
				name: "Hide tags",
				desc: "Also remove tags from the text shown in the outline.",
				control: { type: "toggle", key: "stripTags" },
			},
			{
				name: "Show multiple lines",
				desc: "Wrap long headings and tasks over as many lines as they need. When off, each row is cut to a single line and hovering it shows the full text.",
				aliases: ["wrap", "truncate"],
				control: { type: "toggle", key: "multiLine" },
			},
			{
				name: "Show task checkboxes",
				desc: "Add a checkbox to each task in the popover; clicking it completes the task in the note.",
				control: { type: "toggle", key: "showTaskCheckboxes" },
			},
			{
				name: "Collapsible rows",
				desc: "Allow folding a heading or task to hide the rows nested under it.",
				aliases: ["fold"],
				control: { type: "toggle", key: "collapsible" },
			},
			{
				name: "Popover width",
				desc: "Set the width of the TOC popover in pixels (264 is the default).",
				control: { type: "slider", key: "popoverWidth", min: 160, max: 480, step: 8 },
			},
			{
				// Rendered imperatively: the reset-to-theme affordance is an extra
				// button on the row, which the declarative control shapes cannot
				// express. Still carries name/desc, so it stays searchable.
				name: "Active tab color",
				desc: "Background of the selected tab in the popover. Reset to follow the theme.",
				aliases: ["highlight", "accent"],
				render: (setting) => {
					setting
						.addColorPicker((c) =>
							c
								.setValue(
									(this.getControlValue("activeTabBgColor") as string) ||
										FALLBACK_ACTIVE_TAB_BG,
								)
								.onChange((v) => this.setControlValue("activeTabBgColor", v)),
						)
						.addExtraButton((b) =>
							b
								.setIcon("rotate-ccw")
								.setTooltip("Use the theme's color")
								.onClick(() => {
									this.setControlValue("activeTabBgColor", "");
									this.update();
								}),
						);
				},
			},
			{
				name: "Default tab",
				desc: "Tab shown first in the popover. After that the last-used tab is kept; it always falls back to the tab that has content.",
				// Only meaningful when the popover actually has tabs.
				visible: () => this.plugin.settings.outlineMode === "tabs",
				control: {
					type: "dropdown",
					key: "defaultTab",
					options: { headings: "Headings", tasks: "Tasks" },
				},
			},
		];
	}

	private minimapItems(): SettingGroupItem[] {
		return [
			{
				name: "Minimap marker width",
				desc: "Scale the dashed markers (100% is the default).",
				control: {
					type: "slider",
					key: "minimapWidthScale",
					min: 50,
					max: 200,
					step: 10,
					displayFormat: (v: number) => `${v}%`,
				},
			},
			{
				name: "Minimap vertical scale",
				desc: "Scale marker thickness and spacing to make the minimap shorter or taller (100% is the default size).",
				control: {
					type: "slider",
					key: "minimapVerticalScale",
					min: 50,
					max: 200,
					step: 10,
					displayFormat: (v: number) => `${v}%`,
				},
			},
			{
				name: "Show tasks in minimap",
				desc: "Show the open-task count on the edge of the note, next to the dashed markers. Notes with tasks but no headings always show it, so the TOC stays reachable.",
				control: { type: "toggle", key: "showTasksInMinimap" },
			},
		];
	}

	private behaviorItems(): SettingGroupItem[] {
		return [
			{
				name: "Close delay",
				desc: "How long the popover waits before closing after the mouse leaves it, in milliseconds. Raise it if it closes on you while switching tabs.",
				control: {
					type: "slider",
					key: "closeDelay",
					min: 0,
					max: 1000,
					step: 20,
					displayFormat: (v: number) => `${v} ms`,
				},
			},
			{
				name: "Smooth scroll",
				desc: "Animate the scroll when navigating to a heading.",
				control: { type: "toggle", key: "smoothScroll" },
			},
			{
				name: "Sidebar outline",
				desc: "Also show the outline in Obsidian's own side panel (the drawer on a phone). Off means the plugin never places it by itself — the panel is still there to open from its tab or the \"Open in sidebar\" command.",
				aliases: ["panel", "dock", "drawer", "sidebar", "mobile"],
				control: {
					type: "dropdown",
					key: "sidebarMode",
					options: {
						off: "Off",
						armed: "Keep it in the panel, closed",
						open: "Open it at startup",
					},
				},
			},
			{
				name: "Sidebar side",
				desc: "Which dock the side-panel outline lives in.",
				aliases: ["left", "right"],
				control: {
					type: "dropdown",
					key: "sidebarSide",
					options: { right: "Right", left: "Left" },
				},
			},
			{
				name: "Close the drawer after a row",
				desc: "Phones only: collapse the panel after tapping a row, so the heading that was just scrolled to is visible instead of hidden behind the drawer.",
				aliases: ["phone", "mobile", "tap"],
				control: { type: "toggle", key: "sidebarCollapseOnTap" },
			},
			{
				name: "Scroll to heading on hover",
				desc: "Temporarily scroll to a heading while its TOC row is hovered, then return when the pointer leaves. Click the row to navigate normally and stay there.",
				aliases: ["preview"],
				control: { type: "toggle", key: "scrollToHeadingOnHover" },
			},
		];
	}
}
