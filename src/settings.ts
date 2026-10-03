import { App, PluginSettingTab, Setting } from "obsidian";
import {
	TocDefaultTab,
	TocHeaderButton,
	TocListItems,
	TocOutlineMode,
	TocShow,
	TaskStatusKey,
} from "./types";
import { STATUS_LABELS } from "./outline";
import type SubtleTocPlugin from "./main";

/** Only where the picker starts while the color is unset — a neutral gray, since
 *  the theme's own value can be a translucent rgba() the picker can't show. */
const FALLBACK_ACTIVE_TAB_BG = "#7a7a7a";

/** Statuses offered as toggles, in the order they appear. */
const STATUS_ORDER: TaskStatusKey[] = [
	"todo",
	"inProgress",
	"done",
	"forwarded",
	"important",
	"question",
	"cancelled",
	"other",
];

/**
 * Debounce writes that a slider fires continuously.
 *
 * Dragging a slider emits an event per step, and each one previously wrote
 * settings to disk and rebuilt the entire overlay — roughly sixteen of each
 * for one sweep of the minimap width slider.
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

export class SubtleTocSettingTab extends PluginSettingTab {
	plugin: SubtleTocPlugin;

	constructor(app: App, plugin: SubtleTocPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Persist and rebuild, coalescing the burst a slider drag produces. */
	private readonly commitDebounced = debounce(() => {
		void this.plugin.saveAndRefresh();
	}, 250);

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.addContentSection(containerEl);
		this.addAppearanceSection(containerEl);
		this.addMinimapSection(containerEl);
		this.addBehaviourSection(containerEl);
		this.addMobileSection(containerEl);
	}

	// ---- content -----------------------------------------------------------

	private addContentSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Content").setHeading();

		new Setting(containerEl)
			.setName("Show")
			.setDesc("Which content to surface: headings, open tasks, or both.")
			.addDropdown((d) =>
				d
					.addOption("both", "Both")
					.addOption("headings", "Headings")
					.addOption("tasks", "Tasks")
					.setValue(this.plugin.settings.show)
					.onChange(async (v) => {
						this.plugin.settings.show = v as TocShow;
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Outline mode")
			.setDesc(
				"Unified shows one nested tree with tasks and lists under their heading. Separate tabs keeps the original Headings and Tasks split.",
			)
			.addDropdown((d) =>
				d
					.addOption("unified", "Unified tree")
					.addOption("tabs", "Separate tabs")
					.setValue(this.plugin.settings.outlineMode)
					.onChange(async (v) => {
						this.plugin.settings.outlineMode = v as TocOutlineMode;
						await this.plugin.saveAndRefresh();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("List items")
			.setDesc(
				"Include plain bullets and numbered items, not just checkboxes. Long notes can produce a lot of rows, so this starts off.",
			)
			.addDropdown((d) =>
				d
					.addOption("none", "None")
					.addOption("top", "Top level only")
					.addOption("all", "All")
					.setValue(this.plugin.settings.listItems)
					.onChange(async (v) => {
						this.plugin.settings.listItems = v as TocListItems;
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Callouts")
			.setDesc("Include callout headers, such as a note or warning title, as outline rows.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showCallouts).onChange(async (v) => {
					this.plugin.settings.showCallouts = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Task statuses")
			.setDesc(
				"Which checkbox statuses appear in the outline. Only an unchecked task can be completed from the popover.",
			);

		for (const key of STATUS_ORDER) {
			new Setting(containerEl)
				.setName(STATUS_LABELS[key])
				.setClass("subtle-toc-sub-setting")
				.addToggle((t) =>
					t.setValue(this.plugin.settings.taskStatuses.includes(key)).onChange(async (v) => {
						const set = new Set(this.plugin.settings.taskStatuses);
						if (v) set.add(key);
						else set.delete(key);
						this.plugin.settings.taskStatuses = STATUS_ORDER.filter((k) => set.has(k));
						await this.plugin.saveAndRefresh();
					}),
				);
		}

		new Setting(containerEl)
			.setName("Minimum heading level")
			.setDesc("Lowest heading level to show (1 = H1).")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.minLevel)
					.setDynamicTooltip()
					.onChange((v) => {
						this.plugin.settings.minLevel = v;
						if (v > this.plugin.settings.maxLevel) {
							this.plugin.settings.maxLevel = v;
						}
						this.commitDebounced();
					}),
			);

		new Setting(containerEl)
			.setName("Maximum heading level")
			.setDesc("Highest heading level to show (6 = H6).")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.maxLevel)
					.setDynamicTooltip()
					.onChange((v) => {
						this.plugin.settings.maxLevel = v;
						if (v < this.plugin.settings.minLevel) {
							this.plugin.settings.minLevel = v;
						}
						this.commitDebounced();
					}),
			);
	}

	// ---- appearance --------------------------------------------------------

	private addAppearanceSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Appearance").setHeading();

		new Setting(containerEl)
			.setName("Clean up Markdown")
			.setDesc(
				"Show heading and task text as a reader would see it, resolving links and removing formatting marks.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.stripMarkdown).onChange(async (v) => {
					this.plugin.settings.stripMarkdown = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Hide tags")
			.setDesc("Also remove tags from the text shown in the outline.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.stripTags).onChange(async (v) => {
					this.plugin.settings.stripTags = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Show multiple lines")
			.setDesc(
				"Wrap long headings and tasks over as many lines as they need. When off, each row is cut to a single line and hovering it shows the full text.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.multiLine).onChange(async (v) => {
					this.plugin.settings.multiLine = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Show task checkboxes")
			.setDesc(
				"Add a checkbox to each task in the popover; clicking it completes the task in the note.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTaskCheckboxes).onChange(async (v) => {
					this.plugin.settings.showTaskCheckboxes = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Collapsible rows")
			.setDesc("Allow folding a heading or task to hide the rows nested under it.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.collapsible).onChange(async (v) => {
					this.plugin.settings.collapsible = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Popover width")
			.setDesc("Set the width of the TOC popover in pixels (264 is the default).")
			.addSlider((s) =>
				s
					.setLimits(160, 480, 8)
					.setValue(this.plugin.settings.popoverWidth)
					.setDynamicTooltip()
					.onChange((v) => {
						this.plugin.settings.popoverWidth = v;
						this.commitDebounced();
					}),
			);

		new Setting(containerEl)
			.setName("Active tab color")
			.setDesc("Background of the selected tab in the popover. Reset to follow the theme.")
			.addColorPicker((c) =>
				c
					.setValue(this.plugin.settings.activeTabBgColor || FALLBACK_ACTIVE_TAB_BG)
					.onChange(async (v) => {
						this.plugin.settings.activeTabBgColor = v;
						await this.plugin.saveAndRefresh();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Use the theme's color")
					.onClick(async () => {
						this.plugin.settings.activeTabBgColor = "";
						await this.plugin.saveAndRefresh();
						this.display();
					}),
			);

		if (this.plugin.settings.outlineMode === "tabs") {
			new Setting(containerEl)
				.setName("Default tab")
				.setDesc(
					"Tab shown first in the popover. After that the last-used tab is kept; it always falls back to the tab that has content.",
				)
				.addDropdown((d) =>
					d
						.addOption("headings", "Headings")
						.addOption("tasks", "Tasks")
						.setValue(this.plugin.settings.defaultTab)
						.onChange(async (v) => {
							this.plugin.settings.defaultTab = v as TocDefaultTab;
							await this.plugin.saveAndRefresh();
						}),
				);
		}
	}

	// ---- minimap -----------------------------------------------------------

	private addMinimapSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Minimap").setHeading();

		new Setting(containerEl)
			.setName("Show minimap")
			.setDesc("Show the dashed markers along the edge of the note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showMinimap).onChange(async (v) => {
					this.plugin.settings.showMinimap = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Minimap marker width")
			.setDesc("Scale the dashed markers (100% is the default).")
			.addSlider((s) =>
				s
					.setLimits(50, 200, 10)
					.setValue(this.plugin.settings.minimapWidthScale)
					.setDynamicTooltip()
					.onChange((v) => {
						this.plugin.settings.minimapWidthScale = v;
						this.commitDebounced();
					}),
			);

		new Setting(containerEl)
			.setName("Minimap vertical scale")
			.setDesc(
				"Scale marker thickness and spacing to make the minimap shorter or taller (100% is the default size).",
			)
			.addSlider((s) =>
				s
					.setLimits(50, 200, 10)
					.setValue(this.plugin.settings.minimapVerticalScale)
					.setDynamicTooltip()
					.onChange((v) => {
						this.plugin.settings.minimapVerticalScale = v;
						this.commitDebounced();
					}),
			);

		new Setting(containerEl)
			.setName("Show tasks in minimap")
			.setDesc(
				"Show the open-task count on the edge of the note, next to the dashed markers. Notes with tasks but no headings always show it, so the TOC stays reachable.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTasksInMinimap).onChange(async (v) => {
					this.plugin.settings.showTasksInMinimap = v;
					await this.plugin.saveAndRefresh();
				}),
			);
	}

	// ---- behaviour ---------------------------------------------------------

	private addBehaviourSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Behavior").setHeading();

		new Setting(containerEl)
			.setName("Side")
			.setDesc("Which edge of the note to dock the TOC on.")
			.addDropdown((d) =>
				d
					.addOption("right", "Right")
					.addOption("left", "Left")
					.setValue(this.plugin.settings.side)
					.onChange(async (v) => {
						this.plugin.settings.side = v as "right" | "left";
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Open the popover on")
			.setDesc("Hover over the minimap, or require a click to open. Touch always taps.")
			.addDropdown((d) =>
				d
					.addOption("hover", "Hover")
					.addOption("click", "Click")
					.setValue(this.plugin.settings.openTrigger)
					.onChange(async (v) => {
						this.plugin.settings.openTrigger = v as "hover" | "click";
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Close delay")
			.setDesc(
				"How long the popover waits before closing after the mouse leaves it, in milliseconds. Raise it if it closes on you while switching tabs.",
			)
			.addSlider((s) =>
				s
					.setLimits(0, 1000, 20)
					.setValue(this.plugin.settings.closeDelay)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.closeDelay = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Smooth scroll")
			.setDesc("Animate the scroll when navigating to a heading.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.smoothScroll).onChange(async (v) => {
					this.plugin.settings.smoothScroll = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Scroll to heading on hover")
			.setDesc(
				"Temporarily scroll to a heading while its TOC row is hovered, then return when the pointer leaves. Click the row to navigate normally and stay there.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.scrollToHeadingOnHover).onChange(async (v) => {
					this.plugin.settings.scrollToHeadingOnHover = v;
					await this.plugin.saveSettings();
				}),
			);
	}

	// ---- mobile ------------------------------------------------------------

	private addMobileSection(containerEl: HTMLElement): void {
		new Setting(containerEl).setName("Mobile").setHeading();

		new Setting(containerEl)
			.setName("Note header button")
			.setDesc(
				"Add a button to the note header that opens the outline. On a phone the edge markers are too narrow to tap, so this is the way in.",
			)
			.addDropdown((d) =>
				d
					.addOption("auto", "On mobile only")
					.addOption("always", "Always")
					.addOption("never", "Never")
					.setValue(this.plugin.settings.headerButton)
					.onChange(async (v) => {
						this.plugin.settings.headerButton = v as TocHeaderButton;
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Hide minimap on phones")
			.setDesc(
				"Hide the dashed edge markers on phone-sized screens, where they are too narrow to hit reliably. Tablets keep them.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.hideMinimapOnPhone).onChange(async (v) => {
					this.plugin.settings.hideMinimapOnPhone = v;
					await this.plugin.saveAndRefresh();
				}),
			);
	}
}
