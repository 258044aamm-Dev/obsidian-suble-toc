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
function fakeSetting(parent: HTMLElement, name: string, extraCls = "") {
	const settingEl = document.createElement("div");
	settingEl.className = extraCls ? `setting-item ${extraCls}` : "setting-item";
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
 * on one layout every plausible shape is rendered and every assertion runs
 * against each:
 *
 *   A  the header sits inside the group's list element, with the other rows
 *   B  the header is a direct child of the group container, a sibling of the
 *      list element
 *   C  the header sits inside a plain block wrapper Obsidian created
 *   H  ...inside a row-direction flex wrapper
 *   I  ...inside a column-direction flex wrapper (what phone Obsidian does)
 *
 * A and B test where the framework puts the row; C, H and I test what it puts
 * the row *inside* -- and a host row is given no layout of its own, so the
 * row has to stand on its own in each. The last time this suite encoded an
 * assumption about Obsidian's row layout as its own fixture, the caret under
 * the title passed 90 green assertions on the way to a user's screen.
 *
 * The group container always carries the real `cls` string and the page loads
 * the real stylesheet, so if a settings class ever collides with an overlay
 * class again, overlay layout lands here and the width assertions fail.
 */
function renderPage(opts: { withListEl?: boolean; shape?: "A" | "B" | "C" | "H" | "I" } = {}) {
	const { withListEl = true, shape = "A" } = opts;
	root.empty();
	for (const group of page.items as AnyDef[]) {
		const groupEl = document.createElement("div");
		groupEl.className = group.cls ?? "";
		root.appendChild(groupEl);

		const [header, ...rest] = group.items as AnyDef[];

		// Host shapes wrap the row in a layout Obsidian might own; A and B
		// place it directly, as before.
		const hostLayout = { C: "is-block", H: "is-rowflex", I: "is-columnflex" }[shape] ?? "";
		let rowParent: HTMLElement = groupEl;
		if (hostLayout) {
			const host = document.createElement("div");
			host.className = `subtle-toc-settings-host ${hostLayout}`;
			groupEl.appendChild(host);
			rowParent = host;
		}

		let listEl: HTMLElement;
		let headerSetting: Record<string, any>;

		if (shape === "A") {
			listEl = document.createElement("div");
			groupEl.appendChild(listEl);
			headerSetting = fakeSetting(listEl, header.name);
		} else if (shape === "B") {
			headerSetting = fakeSetting(groupEl, header.name);
			listEl = document.createElement("div");
			groupEl.appendChild(listEl);
		} else {
			// A host row: the framework's own slots exist (as they do in the
			// app), the row carries no layout, and the list is a sibling of
			// the host wrapper.
			headerSetting = fakeSetting(rowParent, header.name, "is-host");
			listEl = document.createElement("div");
			groupEl.appendChild(listEl);
		}

		header.render(headerSetting, withListEl ? { listEl } : undefined);

		// The remaining items are ordinary rows the framework would draw.
		for (const item of rest) fakeSetting(listEl, item.name);
	}
}

/**
 * The negative control: a row built the way Obsidian builds one with no plugin
 * involvement -- title in the framework's info slot, chevron in its control
 * slot, two siblings -- inside a column-direction host. This is the shape the
 * caret bug came out of, and the suite asserts the caret geometry check
 * *fails* against it. A fixture that cannot see the defect is not a fixture.
 */
function renderTwoSlotRow() {
	root.empty();
	const groupEl = document.createElement("div");
	groupEl.className = "subtle-toc-settings-group subtle-toc-settings-group--content";
	root.appendChild(groupEl);

	const host = document.createElement("div");
	host.className = "subtle-toc-settings-host is-columnflex";
	groupEl.appendChild(host);

	// No plugin class on the row at all: nothing of ours may be in play for
	// the control to mean anything. `is-stacked` is the fixture's stand-in for
	// a row Obsidian lays out as a column -- the arrangement the caret bug came
	// out of, whatever puts a row in it.
	const twoSlot = fakeSetting(host, "Content", "is-stacked");
	fakeExtraButton(twoSlot.controlEl);
	const listEl = document.createElement("div");
	groupEl.appendChild(listEl);
	for (const item of (page.items as AnyDef[])[0].items.slice(1)) {
		fakeSetting(listEl, item.name);
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
	 * Where the caret sits relative to the title, and to the row it is in.
	 *
	 * Geometry, not CSS properties: the caret has been moved by layouts that
	 * nothing on the row itself would reveal -- a parent's flex direction, a
	 * sibling's width. The right-hand pair of fields anchors to the row's own
	 * content box, so "on the right-hand side" is measured against the row and
	 * not against the title alone: a caret can sit right of a short title and
	 * still be nowhere near the edge.
	 */
	geometryOf: (id: string) => {
		const header = document.querySelector<HTMLElement>(
			`.subtle-toc-settings-group--${id} .subtle-toc-settings-group-header`,
		)!;
		const title = header.querySelector<HTMLElement>(".subtle-toc-settings-group-title")!;
		const desc = header.querySelector<HTMLElement>(".subtle-toc-settings-group-desc")!;
		const caret = header.querySelector<HTMLElement>(
			".subtle-toc-settings-group-caret .clickable-icon",
		)!;
		const head = header.querySelector<HTMLElement>(".subtle-toc-settings-group-head")!;
		const t = title.getBoundingClientRect();
		const d = desc.getBoundingClientRect();
		const c = caret.getBoundingClientRect();
		const hb = header.getBoundingClientRect();
		const hs = getComputedStyle(header);
		return {
			titleLeft: Math.round(t.left),
			titleRight: Math.round(t.right),
			titleTop: Math.round(t.top),
			titleBottom: Math.round(t.bottom),
			titleMidY: Math.round(t.top + t.height / 2),
			descTop: Math.round(d.top),
			descBottom: Math.round(d.bottom),
			descText: (desc.textContent ?? "").trim(),
			caretLeft: Math.round(c.left),
			caretRight: Math.round(c.right),
			caretMidY: Math.round(c.top + c.height / 2),
			// The row's content box: what "at the right of the row" has to be
			// measured against.
			rowRight: Math.round(hb.right - parseFloat(hs.paddingRight)),
			rowHeight: Math.round(hb.height),
			// The caret's slot is the row's last laid-out element.
			caretIsLast: head.lastElementChild?.classList.contains("subtle-toc-settings-group-caret"),
			// Padding removed, so the comparison does not depend on how roomy
			// the platform's rows happen to be. Laid out as a single row this
			// is about the height of the tallest of the three; stacked it is
			// their sum. Comparing against the sum discriminates the two
			// without a magic threshold.
			contentHeight: Math.round(
				header.clientHeight - parseFloat(hs.paddingTop) - parseFloat(hs.paddingBottom),
			),
			stackedHeight: Math.round(t.height + d.height + c.height),
		};
	},

	/**
	 * What the row shows, and what the framework's own boxes are doing.
	 *
	 * The interior is ours and core's name/desc/control boxes are hidden rather
	 * than emptied, so this checks: exactly one title, description and caret are
	 * visible (the framework's copy is not drawn twice), the caret really is
	 * inside the row's own child, and -- the one that matters for everything
	 * else in the app -- an ordinary settings row keeps its own name visible,
	 * because that `display: none` is one selector away from restyling every row
	 * in the pane, which is what makes it worth asserting.
	 */
	slotsOf: (id: string) => {
		const groupEl = document.querySelector<HTMLElement>(`.subtle-toc-settings-group--${id}`)!;
		const header = groupEl.querySelector<HTMLElement>(".subtle-toc-settings-group-header")!;
		const shown = (el: Element | null | undefined) =>
			!!el && getComputedStyle(el as HTMLElement).display !== "none";
		const count = (sel: string) => [...header.querySelectorAll<HTMLElement>(sel)].filter(shown).length;
		const ordinary = [...groupEl.querySelectorAll<HTMLElement>(".setting-item")].find(
			(el) => el !== header,
		);
		return {
			frameworkInfoHidden: !shown(header.querySelector(":scope > .setting-item-info")),
			frameworkControlHidden: !shown(header.querySelector(":scope > .setting-item-control")),
			visibleTitles: count(".subtle-toc-settings-group-title"),
			visibleDescs: count(".subtle-toc-settings-group-desc"),
			visibleCarets: count(".clickable-icon"),
			caretWithinHead: !!header.querySelector(
				".subtle-toc-settings-group-head > .subtle-toc-settings-group-caret .clickable-icon",
			),
			ordinaryNameVisible: shown(ordinary?.querySelector(".setting-item-name")),
		};
	},

	/**
	 * Geometry of the negative control -- the two-slot row, rendered with no
	 * plugin markup in play. Read from the framework's own slots, because that
	 * is the point of the control.
	 */
	twoSlotGeometry: () => {
		const header = document.querySelector<HTMLElement>(".subtle-toc-settings-host .setting-item")!;
		const title = header.querySelector<HTMLElement>(".setting-item-name")!;
		const caret = header.querySelector<HTMLElement>(".clickable-icon")!;
		const t = title.getBoundingClientRect();
		const c = caret.getBoundingClientRect();
		const hb = header.getBoundingClientRect();
		return {
			titleRight: Math.round(t.right),
			titleMidY: Math.round(t.top + t.height / 2),
			caretLeft: Math.round(c.left),
			caretRight: Math.round(c.right),
			caretMidY: Math.round(c.top + c.height / 2),
			rowRight: Math.round(hb.right),
		};
	},

	/** Renders the negative control: the two-slot row in a column host. */
	renderTwoSlotRow,

	/** Clears the in-memory expanded set the way closing settings does. */
	closeSettings: () => tab.hide(),
};
