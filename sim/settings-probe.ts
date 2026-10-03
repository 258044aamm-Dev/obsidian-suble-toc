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

/**
 * Render the advanced page the way the framework would, structurally.
 *
 * Obsidian owns this markup and the harness cannot see it, so rather than bet
 * on one layout both plausible shapes are rendered and every assertion runs
 * against each:
 *
 *   A  the header sits inside the group's list element, with the other rows
 *   B  the header is a direct child of the group container, a sibling of the
 *      list element
 *
 * The group container always carries the real `cls` string and the page loads
 * the real stylesheet, so if a settings class ever collides with an overlay
 * class again, overlay layout lands here and the width assertions fail.
 */
function renderPage(opts: { withListEl?: boolean; shape?: "A" | "B" } = {}) {
	const { withListEl = true, shape = "A" } = opts;
	root.empty();
	for (const group of page.items as AnyDef[]) {
		const groupEl = document.createElement("div");
		groupEl.className = group.cls ?? "";
		root.appendChild(groupEl);

		const [header, ...rest] = group.items as AnyDef[];

		let listEl: HTMLElement;
		let headerSetting: Record<string, any>;

		if (shape === "A") {
			listEl = document.createElement("div");
			groupEl.appendChild(listEl);
			headerSetting = fakeSetting(listEl, header.name);
		} else {
			headerSetting = fakeSetting(groupEl, header.name);
			listEl = document.createElement("div");
			groupEl.appendChild(listEl);
		}

		header.render(headerSetting, withListEl ? { listEl } : undefined);

		// The remaining items are ordinary rows the framework would draw.
		for (const item of rest) fakeSetting(listEl, item.name);
	}
}

renderPage();

function rowsOf(groupId: string) {
	const groupEl = document.querySelector(`.subtle-toc-settings-group--${groupId}`)!;
	return [...groupEl.querySelectorAll<HTMLElement>(".setting-item")].map((el) => ({
		name: el.querySelector(".setting-item-name")?.textContent ?? "",
		isHeader: el.classList.contains("subtle-toc-settings-group-header"),
		visible: getComputedStyle(el).display !== "none",
	}));
}

(window as unknown as Record<string, unknown>).probe = {
	renderPage,
	rowsOf,
	groupIds: ["content", "appearance", "minimap", "behavior"],
	/**
	 * Row widths against the width the container gives a full-width row.
	 *
	 * Measured, not read off a CSS property: the bug shrank rows through an
	 * inherited `display: flex` on an ancestor, which no property on the row
	 * itself would have revealed. `available` comes from the container's own
	 * content box -- an earlier version appended a probe element and measured
	 * that, which reported 0 inside a flex row because the probe became a flex
	 * item and collapsed, failing the assertion for the wrong reason.
	 */
	widthOf: (id: string) => {
		const groupEl = document.querySelector<HTMLElement>(
			`.subtle-toc-settings-group--${id}`,
		)!;
		const header = groupEl.querySelector<HTMLElement>(".subtle-toc-settings-group-header")!;
		const cs = getComputedStyle(groupEl);
		const available =
			groupEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
		// Visible rows only -- a collapsed row is display:none and measures 0,
		// which would fail the width assertion for the wrong reason.
		const rows = [...groupEl.querySelectorAll<HTMLElement>(".setting-item")].filter(
			(r) => getComputedStyle(r).display !== "none",
		);
		return {
			header: Math.round(header.getBoundingClientRect().width),
			available: Math.round(available),
			// Every row, so a fix that widens the header while squashing the
			// settings underneath it cannot pass.
			narrowest: Math.round(Math.min(...rows.map((r) => r.getBoundingClientRect().width))),
			tint: getComputedStyle(header).backgroundColor,
		};
	},
	/**
	 * Switch between the desktop and mobile fixtures for Obsidian's row.
	 * `is-mobile` is the real class Obsidian puts on body, so the plugin's own
	 * mobile rules come along for the ride.
	 */
	setFixture: (fixture: "desktop" | "mobile") => {
		document.body.classList.toggle("is-mobile", fixture === "mobile");
	},

	/**
	 * Where the caret sits relative to the title.
	 *
	 * Geometry, not CSS properties: the caret dropped below the title through
	 * a `flex-direction` inherited from Obsidian, and reading properties off
	 * the plugin's own rules would have shown nothing wrong.
	 */
	geometryOf: (id: string) => {
		const header = document.querySelector<HTMLElement>(
			`.subtle-toc-settings-group--${id} .subtle-toc-settings-group-header`,
		)!;
		const title = header.querySelector<HTMLElement>(".setting-item-name")!;
		const caret = header.querySelector<HTMLElement>(".clickable-icon")!;
		const t = title.getBoundingClientRect();
		const c = caret.getBoundingClientRect();
		const hs = getComputedStyle(header);
		return {
			caretLeft: Math.round(c.left),
			titleRight: Math.round(t.right),
			caretMidY: Math.round(c.top + c.height / 2),
			titleMidY: Math.round(t.top + t.height / 2),
			rowHeight: Math.round(header.getBoundingClientRect().height),
			// Padding removed, so the comparison does not depend on how roomy
			// the platform's rows happen to be. Laid out as a row this is about
			// max(title, caret); stacked it is title + gap + caret. Comparing it
			// against the sum discriminates the two without a magic threshold.
			contentHeight: Math.round(
				header.clientHeight - parseFloat(hs.paddingTop) - parseFloat(hs.paddingBottom),
			),
			stackedHeight: Math.round(t.height + c.height),
		};
	},

	/** Clears the in-memory expanded set the way closing settings does. */
	closeSettings: () => tab.hide(),
};
