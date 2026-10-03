import { installDomHelpers } from "./obsidian-mock";
import { SubtleTocSettingTab } from "../src/settings";
import { DEFAULT_SETTINGS } from "../src/types";

/**
 * Browser probe for the settings tab's collapse behaviour.
 *
 * Obsidian renders the settings tab itself, so the harness cannot reproduce
 * the real screen and there is no point pretending otherwise. What it *can*
 * do is exercise the one piece of the tab that is our code and that touches
 * the DOM: `wireHeaderRow`, which is handed a row element and a list element
 * and has to make clicking the first hide the contents of the second.
 *
 * The only things faked here are the two value-holders the API passes in --
 * `Setting` (a row element plus addExtraButton) and `SettingGroup` (a list
 * element). Everything being tested is the plugin's real code running against
 * real DOM and the real styles.css.
 */

installDomHelpers();

type AnyDef = Record<string, any>;

const plugin = {
	settings: structuredClone(DEFAULT_SETTINGS),
	saveSettings: async () => {},
	saveAndRefresh: async () => {},
};

function fakeExtraButton(containerEl: HTMLElement) {
	const el = document.createElement("div");
	el.className = "clickable-icon extra-setting-button";
	containerEl.appendChild(el);
	const comp: Record<string, any> = {
		extraSettingsEl: el,
		setIcon(icon: string) {
			el.dataset.icon = icon;
			return comp;
		},
		setTooltip(text: string) {
			el.setAttribute("aria-label", text);
			return comp;
		},
		setDisabled() {
			return comp;
		},
		onClick(fn: () => void) {
			el.addEventListener("click", fn);
			return comp;
		},
	};
	return comp;
}

/** A stand-in for Obsidian's Setting, backed by a real `.setting-item`. */
function fakeSetting(parent: HTMLElement, name: string) {
	const settingEl = document.createElement("div");
	settingEl.className = "setting-item";
	const infoEl = document.createElement("div");
	infoEl.className = "setting-item-info";
	const nameEl = document.createElement("div");
	nameEl.className = "setting-item-name";
	nameEl.textContent = name;
	infoEl.appendChild(nameEl);
	const controlEl = document.createElement("div");
	controlEl.className = "setting-item-control";
	settingEl.append(infoEl, controlEl);
	parent.appendChild(settingEl);

	const setting: Record<string, any> = {
		settingEl,
		infoEl,
		nameEl,
		controlEl,
		setName(v: string) {
			nameEl.textContent = v;
			return setting;
		},
		setDesc() {
			return setting;
		},
		addExtraButton(cb: (c: unknown) => void) {
			cb(fakeExtraButton(controlEl));
			return setting;
		},
		addColorPicker() {
			return setting;
		},
	};
	return setting;
}

const root = document.getElementById("settings")!;

const tab = new SubtleTocSettingTab({} as never, plugin as never);
const defs = tab.getSettingDefinitions() as AnyDef[];
const page = defs.find((d) => d.type === "page")!;

/** Render the advanced page the way the framework would, structurally. */
function renderPage(opts: { withListEl: boolean }) {
	root.empty();
	for (const group of page.items as AnyDef[]) {
		const groupEl = document.createElement("div");
		groupEl.className = group.cls ?? "";
		root.appendChild(groupEl);

		const listEl = document.createElement("div");
		groupEl.appendChild(listEl);

		const [header, ...rest] = group.items as AnyDef[];

		// The header is the group's first item, rendered imperatively.
		const headerSetting = fakeSetting(listEl, header.name);
		header.render(headerSetting, opts.withListEl ? { listEl } : undefined);

		// The remaining items are ordinary rows the framework would draw.
		for (const item of rest) fakeSetting(listEl, item.name);
	}
}

renderPage({ withListEl: true });

function rowsOf(groupId: string) {
	const groupEl = document.querySelector(`.subtle-toc-group--${groupId}`)!;
	return [...groupEl.querySelectorAll<HTMLElement>(".setting-item")].map((el) => ({
		name: el.querySelector(".setting-item-name")?.textContent ?? "",
		isHeader: el.classList.contains("subtle-toc-group-header"),
		visible: getComputedStyle(el).display !== "none",
	}));
}

(window as unknown as Record<string, unknown>).probe = {
	renderPage,
	rowsOf,
	groupIds: ["content", "appearance", "minimap", "behavior"],
	headerOf: (id: string) =>
		document.querySelector<HTMLElement>(`.subtle-toc-group--${id} .subtle-toc-group-header`),
	chevronOf: (id: string) =>
		document.querySelector<HTMLElement>(
			`.subtle-toc-group--${id} .subtle-toc-group-header .clickable-icon`,
		),
	listOf: (id: string) =>
		document.querySelector<HTMLElement>(`.subtle-toc-group--${id} .subtle-toc-group-list`),
	/** Clears the in-memory expanded set the way closing settings does. */
	closeSettings: () => tab.hide(),
};
