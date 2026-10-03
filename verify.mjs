/**
 * Drives the simulation harness in a real browser and asserts the behaviour
 * that unit tests cannot reach: layout, pointer interaction, the mobile sheet,
 * folding, and navigation.
 *
 *   node verify.mjs            # assert only
 *   node verify.mjs --shots    # also write screenshots to ../shots
 */
import { chromium } from "playwright-core";
import fs from "fs";

const URL = process.env.SIM_URL ?? "http://127.0.0.1:8080/index.html";
const PROBE_URL = process.env.PROBE_URL ?? "http://127.0.0.1:8080/settings-probe.html";
const PLUGIN_URL = process.env.PLUGIN_URL ?? "http://127.0.0.1:8080/plugin.html";
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = "/home/user/shots";
if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

let pass = 0;
const failures = [];

function check(name, condition, detail = "") {
	if (condition) {
		pass++;
		console.log(`  ok   ${name}`);
	} else {
		failures.push(`${name}${detail ? ` -- ${detail}` : ""}`);
		console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
	}
}

const browser = await chromium.launch({
	executablePath: process.env.EXE,
	args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

const consoleErrors = [];

/**
 * A page running the *real plugin* against the mock workspace: registration,
 * the startup placement, and the two commands. Device profile and stored
 * settings are set before the reload the driver triggers, because placement
 * happens once, at layout-ready.
 */
async function newPluginPage({ device = "desktop", mode = "armed", side = "right" } = {}) {
	const page = await browser.newPage({ viewport: { width: 1340, height: 920 } });
	page.on("console", (m) => {
		if (m.type() === "error" && !m.text().includes("favicon")) consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));
	await page.goto(PLUGIN_URL, { waitUntil: "networkidle" });
	// The settings have to be in place *before* the plugin loads: placement runs
	// once, at layout-ready. So store them, then boot again.
	await page.evaluate(
		({ mode, side }) => {
			localStorage.setItem(
				"subtle-toc-sim-settings",
				JSON.stringify({ sidebarMode: mode, sidebarSide: side, sidebarCollapseOnTap: true }),
			);
		},
		{ mode, side },
	);
	await page.reload({ waitUntil: "networkidle" });
	await page.waitForFunction(() => window.pluginSim?.ready === true, null, { timeout: 5000 });
	await page.evaluate((device) => window.pluginSim.setPlatform(device), device);
	await page.evaluate(
		({ mode, side }) => {
			(document.getElementById("sidebarMode")).value = mode;
			(document.getElementById("sidebarSide")).value = side;
		},
		{ mode, side },
	);
	return page;
}

const placementOf = (page) =>
	page.evaluate(() => window.pluginSim.app.workspace.sideLeafCalls.map((c) => [c.side, c.options]));

async function newPage(opts = {}) {
	const page = await browser.newPage({
		viewport: { width: 1340, height: 920 },
		deviceScaleFactor: 2,
		...opts,
	});
	page.on("console", (m) => {
		if (m.type() === "error" && !m.text().includes("favicon")) consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));
	await page.goto(URL, { waitUntil: "networkidle" });
	await page.waitForTimeout(350);
	return page;
}

const rowsOf = (page) =>
	page.$$eval(".subtle-toc-root .subtle-toc-item", (els) =>
		els.map((e) => ({
			kind: (e.className.match(/subtle-toc-kind-(\w+)/) || [])[1] || "?",
			// The row also contains a status glyph, so read the text span only.
			text: (e.querySelector(".subtle-toc-item-text")?.textContent || "").trim(),
			status: (e.className.match(/subtle-toc-status-(\w+)/) || [])[1] || null,
			pad: parseFloat(getComputedStyle(e).paddingLeft),
			cls: e.className,
			h: Math.round(e.getBoundingClientRect().height),
		})),
	);

/** Rows of the sidebar panel, in the same shape rowsOf() gives for the popover. */
const panelRowsOf = (page) =>
	page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) =>
		els.map((e) => ({
			kind: (e.className.match(/subtle-toc-kind-(\w+)/) || [])[1] || "?",
			text: (e.querySelector(".subtle-toc-item-text")?.textContent || "").trim(),
			cls: e.className,
			pad: parseFloat(getComputedStyle(e).paddingLeft),
		})),
	);

const setSelect = async (page, id, value) => {
	await page.selectOption(`#${id}`, value);
	await page.waitForTimeout(250);
};
const setCheck = async (page, id, value) => {
	await page.setChecked(`#${id}`, value);
	await page.waitForTimeout(250);
};

/* ---------------------------------------------------------------- desktop */

console.log("\nDesktop — default settings");
{
	const page = await newPage();

	const closed = await page.evaluate(() => {
		const root = document.querySelector(".subtle-toc-root");
		const pop = root.querySelector(".subtle-toc-popover");
		return {
			rootPos: getComputedStyle(root).position,
			popOpacity: getComputedStyle(pop).opacity,
			mmW: Math.round(root.querySelector(".subtle-toc-minimap").getBoundingClientRect().width),
			dashes: root.querySelectorAll(".subtle-toc-dash").length,
			tabsDisplay: getComputedStyle(root.querySelector(".subtle-toc-tabs")).display,
		};
	});
	check("overlay is absolutely positioned inside the note", closed.rootPos === "absolute");
	check("popover starts hidden", closed.popOpacity === "0", `opacity=${closed.popOpacity}`);
	check("minimap has width", closed.mmW > 0, `w=${closed.mmW}`);
	check("one dash per heading", closed.dashes === 11, `dashes=${closed.dashes}`);
	check("tab bar hidden in unified mode", closed.tabsDisplay === "none", closed.tabsDisplay);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/01-desktop-closed.png` });

	await page.hover(".subtle-toc-minimap");
	await page.waitForTimeout(450);
	const openOpacity = await page.$eval(".subtle-toc-popover", (e) => getComputedStyle(e).opacity);
	check("hover opens the popover", openOpacity === "1", `opacity=${openOpacity}`);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/02-desktop-open.png` });

	const rows = await rowsOf(page);
	check("17 rows by default (11 headings + 6 open tasks)", rows.length === 17, `n=${rows.length}`);
	check(
		"only todo tasks appear",
		!rows.some((r) => /Book the room|Budget model|Cancelled|Deferred|vendor deliver|Headcount freeze/.test(r.text)),
	);
	check("no plain bullets by default", !rows.some((r) => r.kind === "list"));
	check("no callouts by default", !rows.some((r) => r.kind === "callout"));
	check(
		"markdown is stripped",
		rows.some((r) => r.text === "Draft the agenda for the sync"),
		rows.find((r) => /Draft/.test(r.text))?.text,
	);
	check(
		"task emoji metadata is stripped",
		rows.some((r) => r.text === "Share pre-reading"),
		rows.find((r) => /pre-reading/.test(r.text))?.text,
	);
	check(
		"sub-task indents past its parent task",
		(() => {
			const parent = rows.find((r) => r.text === "Draft the agenda for the sync");
			const child = rows.find((r) => r.text === "Collect topics from each team");
			return parent && child && child.pad > parent.pad;
		})(),
	);
	check(
		"H3 indents past H2",
		(() => {
			const h2 = rows.find((r) => r.text === "Planning");
			const h3 = rows.find((r) => r.text === "Dependencies");
			return h2 && h3 && h3.pad > h2.pad;
		})(),
	);

	// Re-open programmatically: moving the pointer off the minimap re-arms the
	// close timer, which is correct behaviour but races the driver.
	await page.click("#open");
	await page.waitForTimeout(250);

	// Folding
	const before = (await rowsOf(page)).length;
	await page.click(".subtle-toc-root .subtle-toc-item.subtle-toc-kind-heading.is-foldable .subtle-toc-twisty");
	await page.waitForTimeout(250);
	const after = (await rowsOf(page)).length;
	check("folding hides descendants", after < before, `${before} -> ${after}`);
	await page.click(".subtle-toc-root .subtle-toc-item.subtle-toc-kind-heading.is-collapsed .subtle-toc-twisty");
	await page.waitForTimeout(250);
	check("unfolding restores them", (await rowsOf(page)).length === before);

	// Navigation
	await page.click("#open");
	await page.waitForTimeout(200);
	const scrollBefore = await page.$eval("#note-scroll", (e) => e.scrollTop);
	const target = await page.$$eval(".subtle-toc-root .subtle-toc-item", (els) => {
		const i = els.findIndex((e) => e.textContent.trim() === "Changelog");
		return i;
	});
	await page.$$eval(
		".subtle-toc-root .subtle-toc-item",
		(els, i) => els[i].dispatchEvent(new MouseEvent("click", { bubbles: true })),
		target,
	);
	await page.waitForTimeout(700);
	const scrollAfter = await page.$eval("#note-scroll", (e) => e.scrollTop);
	check("clicking a row scrolls the note", scrollAfter > scrollBefore, `${scrollBefore} -> ${scrollAfter}`);

	const activeText = await page
		.$eval(".subtle-toc-root .subtle-toc-item.is-active", (e) => e.textContent.trim())
		.catch(() => null);
	check("an active row is tracked after scrolling", activeText !== null, `active=${activeText}`);

	await page.close();
}

/* ---------------------------------------------------- content type toggles */

console.log("\nDesktop — content toggles");
{
	const page = await newPage();
	await page.click("#open");
	await page.waitForTimeout(250);

	const base = (await rowsOf(page)).length;

	await setCheck(page, "allStatuses", true);
	const withStatuses = await rowsOf(page);
	check("all statuses adds the other tasks", withStatuses.length > base, `${base} -> ${withStatuses.length}`);
	check(
		"a done task renders struck",
		withStatuses.some(
			(r) => r.text === "Book the room" && r.cls.includes("subtle-toc-status-done"),
		),
	);
	check(
		"an in-progress task is classed",
		withStatuses.some((r) => r.cls.includes("subtle-toc-status-inProgress")),
	);
	await setCheck(page, "allStatuses", false);

	await setSelect(page, "listItems", "all");
	const withLists = await rowsOf(page);
	check("bullets appear", withLists.some((r) => r.kind === "list" && r.text.includes("plain bullet")));
	check(
		"numbered items appear",
		withLists.some((r) => r.kind === "list" && r.text.includes("First numbered item")),
	);
	await setSelect(page, "listItems", "none");

	await setCheck(page, "showCallouts", true);
	const withCallouts = await rowsOf(page);
	check(
		"callout headers appear",
		withCallouts.some((r) => r.kind === "callout" && r.text.includes("Blocked on finance")),
	);
	await setCheck(page, "showCallouts", false);

	await setCheck(page, "stripMarkdown", false);
	const raw = await rowsOf(page);
	check(
		"raw markdown shows when stripping is off",
		raw.some((r) => r.text.includes("**agenda**")),
		raw.find((r) => /agenda/.test(r.text))?.text,
	);
	await setCheck(page, "stripMarkdown", true);

	await setSelect(page, "outlineMode", "tabs");
	await page.click("#open");
	await page.waitForTimeout(300);
	const tabsVisible = await page.$eval(
		".subtle-toc-tabs",
		(e) => getComputedStyle(e).display !== "none",
	);
	check("tabs mode restores the tab bar", tabsVisible);
	const headingsOnly = await rowsOf(page);
	check(
		"headings tab shows no tasks",
		headingsOnly.every((r) => r.kind !== "task"),
		`kinds=${[...new Set(headingsOnly.map((r) => r.kind))]}`,
	);
	await page.click("#open");
	await page.waitForTimeout(200);
	await page.$$eval(".subtle-toc-root .subtle-toc-tab", (els) => {
		const tasks = els.find((e) => /Tasks/.test(e.textContent));
		tasks.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(300);
	const tasksOnly = await rowsOf(page);
	check(
		"tasks tab shows only tasks",
		tasksOnly.length > 0 && tasksOnly.every((r) => r.kind === "task"),
		`kinds=${[...new Set(tasksOnly.map((r) => r.kind))]}`,
	);
	// Without the heading rows on screen, inherited heading depth would indent
	// tasks for no visible reason. Top-level tasks must all sit flush.
	const topTasks = tasksOnly.filter((r) => !/Collect topics/.test(r.text));
	check(
		"tasks tab does not inherit hidden heading indentation",
		new Set(topTasks.map((r) => r.pad)).size === 1,
		topTasks.map((r) => `${r.text}=${r.pad}`).join(", "),
	);
	check(
		"a sub-task still nests under its parent task",
		(() => {
			const child = tasksOnly.find((r) => /Collect topics/.test(r.text));
			return child && child.pad > topTasks[0].pad;
		})(),
	);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/03-desktop-tabs-mode.png` });

	await page.close();
}

/* ------------------------------------------------------------------ phone */

console.log("\nPhone");
{
	const page = await newPage({ hasTouch: true });
	await setSelect(page, "device", "phone");

	const phone = await page.evaluate(() => {
		const root = document.querySelector(".subtle-toc-root");
		const mm = root.querySelector(".subtle-toc-minimap");
		return {
			rootCls: root.className,
			mmHidden: mm.classList.contains("is-hidden") || getComputedStyle(mm).display === "none",
			headerButtons: document.querySelectorAll("#header-actions .view-action").length,
		};
	});
	check("root is flagged as phone", phone.rootCls.includes("is-phone"), phone.rootCls);
	check("minimap is hidden on phone", phone.mmHidden);
	check("note header gets exactly one button", phone.headerButtons === 1, `n=${phone.headerButtons}`);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/04-phone-closed.png` });

	await page.click("#header-actions .view-action");
	await page.waitForTimeout(450);

	const sheet = await page.evaluate(() => {
		const root = document.querySelector(".subtle-toc-root");
		const pop = root.querySelector(".subtle-toc-popover");
		const bd = root.querySelector(".subtle-toc-backdrop");
		const close = root.querySelector(".subtle-toc-close");
		const row = root.querySelector(".subtle-toc-item");
		return {
			isSheet: root.classList.contains("is-sheet"),
			isOpen: root.classList.contains("is-open"),
			popPos: getComputedStyle(pop).position,
			popW: Math.round(pop.getBoundingClientRect().width),
			bdOpacity: getComputedStyle(bd).opacity,
			bdEvents: getComputedStyle(bd).pointerEvents,
			closeDisplay: getComputedStyle(close).display,
			rowH: Math.round(row.getBoundingClientRect().height),
		};
	});
	check("header button opens the sheet", sheet.isOpen && sheet.isSheet);
	check("sheet is fixed-position", sheet.popPos === "fixed", sheet.popPos);
	check("sheet is wider than the desktop popover", sheet.popW > 264, `w=${sheet.popW}`);
	check("backdrop is visible and tappable", sheet.bdOpacity === "1" && sheet.bdEvents === "auto");
	check("close button is shown in the sheet", sheet.closeDisplay !== "none");
	check("touch rows meet the 44px minimum", sheet.rowH >= 44, `h=${sheet.rowH}`);

	const twisties = await page.$$eval(".subtle-toc-root .subtle-toc-item", (els) =>
		els.map((e) => ({
			foldable: e.classList.contains("is-foldable"),
			opacity: parseFloat(getComputedStyle(e.querySelector(".subtle-toc-twisty")).opacity),
			text: (e.querySelector(".subtle-toc-item-text") || {}).textContent || "",
		})),
	);
	check(
		"leaf rows show no fold chevron in the sheet",
		twisties.filter((t) => !t.foldable).every((t) => t.opacity === 0),
		twisties.filter((t) => !t.foldable && t.opacity !== 0).map((t) => t.text.trim()).join(", "),
	);
	check(
		"foldable rows do show one",
		twisties.filter((t) => t.foldable).every((t) => t.opacity > 0),
	);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/05-phone-sheet.png` });

	await page.click(".subtle-toc-backdrop", { position: { x: 10, y: 10 } });
	await page.waitForTimeout(350);
	const afterBackdrop = await page.$eval(".subtle-toc-root", (e) => e.className);
	check("tapping the backdrop closes the sheet", !afterBackdrop.includes("is-open"), afterBackdrop);

	// A tap on a row should navigate and dismiss.
	await page.click("#header-actions .view-action");
	await page.waitForTimeout(400);
	await page.$$eval(".subtle-toc-root .subtle-toc-item", (els) => {
		const t = els.find((e) => e.textContent.trim() === "Risks");
		t.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(500);
	const afterTap = await page.$eval(".subtle-toc-root", (e) => e.className);
	check("tapping a row dismisses the sheet", !afterTap.includes("is-open"), afterTap);

	await page.close();
}

/* ----------------------------------------------------------------- tablet */

console.log("\nTablet");
{
	const page = await newPage({ hasTouch: true });
	await setSelect(page, "device", "tablet");
	const tablet = await page.evaluate(() => {
		const root = document.querySelector(".subtle-toc-root");
		const mm = root.querySelector(".subtle-toc-minimap");
		return {
			mmHidden: mm.classList.contains("is-hidden") || getComputedStyle(mm).display === "none",
			headerButtons: document.querySelectorAll("#header-actions .view-action").length,
		};
	});
	check("tablet keeps the minimap", !tablet.mmHidden);
	check("tablet also gets the header button", tablet.headerButtons === 1);
	if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/06-tablet.png` });
	await page.close();
}

/* -------------------------------------------------------- header button off */

console.log("\nHeader button: never");
{
	const page = await newPage();
	await setSelect(page, "headerButton", "never");
	const n = await page.$$eval("#header-actions .view-action", (e) => e.length);
	check("no header button when disabled", n === 0, `n=${n}`);
	await setSelect(page, "headerButton", "always");
	const n2 = await page.$$eval("#header-actions .view-action", (e) => e.length);
	check("exactly one button when always on (no duplicates)", n2 === 1, `n=${n2}`);
	await page.close();
}

/* ------------------------------------------- settings: collapsible groups */

{
	console.log("\nSettings tab: collapsible groups");
	const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
	page.on("console", (m) => {
		if (m.type() === "error" && !m.text().includes("favicon")) consoleErrors.push(m.text());
	});
	page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + e.message));
	await page.goto(PROBE_URL, { waitUntil: "networkidle" });
	await page.waitForTimeout(200);

	const HEADER = ".subtle-toc-settings-group-header";
	const g = (id) => `.subtle-toc-settings-group--${id}`;
	const rows = (id) => page.evaluate((x) => window.probe.rowsOf(x), id);
	const width = (id) => page.evaluate((x) => window.probe.widthOf(x), id);
	const geom = (id) => page.evaluate((x) => window.probe.geometryOf(x), id);
	const slots = (id) => page.evaluate((x) => window.probe.slotsOf(x), id);

	// Click the row *body*, the way a pointer would: a point inside the row and
	// clear of the caret. The old suite clicked `.setting-item-info`, a box the
	// plugin no longer draws into -- and clicking a child by name would pass
	// even if the row had no hit area of its own. Clicking the locator (rather
	// than the mouse at a measured point) is also what scrolls the row into
	// view: every group below the first is off-screen once the ones above it
	// are open, and a mouse click at those coordinates lands on nothing.
	const clickRowBody = async (id) => {
		const row = page.locator(`${g(id)} ${HEADER}`);
		const box = await row.boundingBox();
		await row.click({ position: { x: 24, y: box.height / 2 } });
	};

	// ---------------------------------------------------------- the control
	//
	// First, the shape the bug came out of: title in the framework's info box,
	// chevron in its control box, two siblings inside a column-direction host,
	// and no plugin markup anywhere. The assertion below has to *fail* here, or
	// this suite cannot see the defect it exists for -- which is exactly how
	// three releases shipped a caret under the title with 160 green checks.
	await page.evaluate(() => window.probe.renderTwoSlotRow());
	{
		const c = await page.evaluate(() => window.probe.twoSlotGeometry());
		check(
			"[control] a two-slot row in a column host puts the caret under the title",
			c.caretLeft < c.titleRight && Math.abs(c.caretMidY - c.titleMidY) >= 2,
			`caretLeft=${c.caretLeft} titleRight=${c.titleRight} caretMidY=${c.caretMidY} titleMidY=${c.titleMidY}`,
		);
	}

	// Two axes, because each one hid a bug that reached the user.
	//
	//   fixture  desktop vs mobile. Obsidian stacks a settings row on mobile
	//            unless it carries a control modifier class.
	//   shape    what the framework puts the row in. A and B: inside the
	//            group's list element, or beside it. C, H, I: inside a plain
	//            block wrapper, a row-direction flex one, and a column one --
	//            and in those the row is given no layout of its own, so the
	//            plugin's row has to stand on its own in each direction.
	//            Obsidian owns all of this markup and the harness cannot see
	//            it, so every plausible shape is asserted against, not bet on.
	for (const fixture of ["desktop", "mobile"]) {
		await page.setViewportSize(
			fixture === "mobile" ? { width: 390, height: 844 } : { width: 900, height: 900 },
		);
		await page.evaluate((f) => window.probe.setFixture(f), fixture);

		for (const shape of ["A", "B", "C", "H", "I"]) {
			const tag = `${fixture}/${shape}`;
			console.log(`  -- ${tag}`);
			await page.evaluate((sh) => window.probe.renderPage({ shape: sh }), shape);

			// Width. Catches a class collision dragging overlay layout in.
			for (const id of ["content", "behavior"]) {
				const w = await width(id);
				check(
					`[${tag}] ${id} header fills the pane`,
					w.header === w.available && w.available > 150,
					`header=${w.header} available=${w.available}`,
				);
				check(
					`[${tag}] ${id} every row fills the pane`,
					w.narrowest === w.available,
					`narrowest=${w.narrowest} available=${w.available}`,
				);
			}

			// The row's interior. One title, one description, one caret, all
			// drawn by the plugin -- and the framework's own boxes taken out of
			// the layout without touching any other row's.
			for (const id of ["content", "behavior"]) {
				const s = await slots(id);
				check(
					`[${tag}] ${id} the framework's name and control boxes are not drawn`,
					s.frameworkInfoHidden && s.frameworkControlHidden,
					JSON.stringify(s),
				);
				check(
					`[${tag}] ${id} exactly one title, description and caret are visible`,
					s.visibleTitles === 1 && s.visibleDescs === 1 && s.visibleCarets === 1,
					JSON.stringify(s),
				);
				check(
					`[${tag}] ${id} the caret lives in the row's own child`,
					s.caretWithinHead,
				);
				check(
					`[${tag}] ${id} hiding the framework's boxes leaves other rows alone`,
					s.ordinaryNameVisible,
				);
			}

			// Geometry. The caret must sit out at the right-hand edge of the
			// row, level with the title and description it belongs to -- not
			// under the title, and not merely right of a short one.
			for (const id of ["content", "behavior"]) {
				const geo = await geom(id);
				check(
					`[${tag}] ${id} caret sits right of the title`,
					geo.caretLeft >= geo.titleRight,
					`caretLeft=${geo.caretLeft} titleRight=${geo.titleRight}`,
				);
				// The row's text is two lines now, so the caret is centred on
				// the block rather than on the title alone -- what Obsidian does
				// with a control beside a name and description.
				check(
					`[${tag}] ${id} caret is level with the row's text`,
					Math.abs(geo.caretMidY - (geo.titleTop + geo.descBottom) / 2) < 3,
					`caretMidY=${geo.caretMidY} text=${Math.round((geo.titleTop + geo.descBottom) / 2)}`,
				);
				check(
					`[${tag}] ${id} caret sits at the right-hand edge of the row`,
					geo.caretRight >= geo.rowRight - 3,
					`caretRight=${geo.caretRight} rowRight=${geo.rowRight}`,
				);
				// Laid out as a row the content is about the tallest of the
				// three; stacked it is their sum. No magic threshold.
				check(
					`[${tag}] ${id} header is one row, not three stacked`,
					geo.contentHeight < geo.stackedHeight,
					`content=${geo.contentHeight} stacked=${geo.stackedHeight} rowHeight=${geo.rowHeight}`,
				);
				check(
					`[${tag}] ${id} group carries a description under its title`,
					geo.descText.length > 0 &&
						geo.descTop >= geo.titleBottom - 2 &&
						geo.descTop <= geo.titleBottom + 8,
					`desc="${geo.descText}" descTop=${geo.descTop} titleBottom=${geo.titleBottom}`,
				);
				check(
					`[${tag}] ${id} the caret is the row's last element`,
					geo.caretIsLast === true,
				);
			}

			const tint = (await width("content")).tint;
			check(
				`[${tag}] header carries a background tint`,
				tint !== "rgba(0, 0, 0, 0)" && tint !== "transparent",
				tint,
			);

			const headerIsRow = await page.$eval(`${g("content")} ${HEADER}`, (el) => ({
				settingItem: el.classList.contains("setting-item"),
				heading: el.classList.contains("setting-item-heading"),
				cursor: getComputedStyle(el).cursor,
				role: el.getAttribute("role"),
			}));
			check(
				`[${tag}] group header is a setting row`,
				headerIsRow.settingItem && !headerIsRow.heading,
			);
			check(`[${tag}] header looks clickable`, headerIsRow.cursor === "pointer", headerIsRow.cursor);
			check(`[${tag}] header is exposed as a button`, headerIsRow.role === "button");

			const initial = await rows("content");
			check(
				`[${tag}] all four groups start collapsed`,
				initial.filter((r) => r.visible).length === 1,
			);
			check(
				`[${tag}] the header itself stays visible when collapsed`,
				initial[0].isHeader && initial[0].visible,
			);
			check(
				`[${tag}] no setting row is visible while collapsed`,
				initial.filter((r) => !r.isHeader).every((r) => !r.visible),
			);

			// Clicking the row body expands.
			await clickRowBody("content");
			const opened = await rows("content");
			check(
				`[${tag}] clicking the header expands the group`,
				opened.every((r) => r.visible),
				opened
					.filter((r) => !r.visible)
					.map((r) => r.name)
					.join(", "),
			);
			check(
				`[${tag}] aria-expanded tracks the state`,
				(await page.getAttribute(`${g("content")} ${HEADER}`, "aria-expanded")) === "true",
			);
			check(
				`[${tag}] the caret flips to open when expanded`,
				(await page.getAttribute(`${g("content")} ${HEADER} .clickable-icon`, "data-icon")) ===
					"chevron-down",
			);
			const openW = await width("content");
			check(
				`[${tag}] every row fills the pane when expanded`,
				openW.narrowest === openW.available,
				`narrowest=${openW.narrowest} available=${openW.available}`,
			);
			// The caret must stay put once the group is open.
			const openGeo = await geom("content");
			check(
				`[${tag}] caret stays beside the title when expanded`,
				openGeo.caretLeft >= openGeo.titleRight &&
					Math.abs(openGeo.caretMidY - (openGeo.titleTop + openGeo.descBottom) / 2) < 3 &&
					openGeo.caretRight >= openGeo.rowRight - 3,
				`caretLeft=${openGeo.caretLeft} titleRight=${openGeo.titleRight} caretRight=${openGeo.caretRight} rowRight=${openGeo.rowRight}`,
			);

			// Clicking the chevron must toggle once, not twice.
			await page.click(`${g("content")} ${HEADER} .clickable-icon`);
			const afterChevron = await rows("content");
			check(
				`[${tag}] clicking the chevron collapses (one toggle, not two)`,
				afterChevron.filter((r) => r.visible).length === 1,
				`${afterChevron.filter((r) => r.visible).length} visible`,
			);

			await page.focus(`${g("content")} ${HEADER}`);
			await page.keyboard.press("Enter");
			check(`[${tag}] Enter toggles the group`, (await rows("content")).every((r) => r.visible));

			check(
				`[${tag}] groups toggle independently`,
				(await rows("appearance")).filter((r) => r.visible).length === 1,
			);

			for (const id of ["appearance", "minimap", "behavior"]) {
				await clickRowBody(id);
			}
			let allVisible = true;
			for (const id of ["content", "appearance", "minimap", "behavior"]) {
				if (!(await rows(id)).every((r) => r.visible)) allVisible = false;
			}
			check(`[${tag}] every group can be opened at once`, allVisible);

			// Closing the settings window resets to collapsed.
			await page.evaluate((sh) => {
				window.probe.closeSettings();
				window.probe.renderPage({ shape: sh });
			}, shape);
			check(
				`[${tag}] reopening settings shows the groups collapsed again`,
				(await rows("content")).filter((r) => r.visible).length === 1,
			);

			// The documented degradation: no list element means stay open.
			await page.evaluate(
				(sh) => window.probe.renderPage({ shape: sh, withListEl: false }),
				shape,
			);
			check(
				`[${tag}] degrades to fully expanded when the list element is missing`,
				(await rows("content")).every((r) => r.visible),
			);
			// The check above passes trivially -- with no list element no class is
			// applied, so rows show whatever the state says. This one tests that
			// degrading recorded the group as open: a later render that *does* get
			// a list element must not snap it shut under the user.
			await page.evaluate((sh) => window.probe.renderPage({ shape: sh }), shape);
			const recovered = await rows("content");
			check(
				`[${tag}] a degraded group stays open once rendering recovers`,
				recovered.every((r) => r.visible),
				`${recovered.filter((r) => !r.visible).length} hidden`,
			);

			await page.evaluate(() => window.probe.closeSettings());
		}

		if (SHOTS) {
			await page.evaluate(() => window.probe.renderPage({ shape: "I" }));
			await page.screenshot({
				path: `${SHOT_DIR}/07-settings-groups-${fixture}.png`,
				fullPage: true,
			});
		}
	}

	await page.close();
}

/* ------------------------------------------------------------ sidebar view */

/**
 * The panel is mounted in the page from the start, next to the overlay, so
 * every assertion above also proves the two surfaces coexist. These are about
 * the panel itself: that it renders the same tree, and that it drives the same
 * behaviours, rather than a second implementation that looks similar today.
 */
{
	const page = await newPage();

	await page.click("#open");
	await page.waitForTimeout(300);

	const popover = await rowsOf(page);
	const panel = await panelRowsOf(page);
	check(
		"the panel renders the same rows as the popover, in order",
		panel.length > 0 &&
			panel.length === popover.length &&
			panel.every((r, i) => r.text === popover[i].text && r.kind === popover[i].kind),
		`panel=${panel.length} popover=${popover.length} ` +
			panel
				.filter((r, i) => !popover[i] || r.text !== popover[i].text)
				.map((r) => r.text)
				.join(", "),
	);
	check(
		"the panel is a second surface, not a second overlay",
		(await page.$$eval(".subtle-toc-root", (e) => e.length)) === 1,
	);
	check(
		"both surfaces are on screen at once",
		(await page.$eval(".subtle-toc-popover", (e) => getComputedStyle(e).opacity)) === "1" &&
			(await page.$eval(".subtle-toc-sidebar", (e) => e.clientHeight)) > 100,
	);

	// Same settings, same rows: the equality above must not be a coincidence of
	// the default configuration.
	await setSelect(page, "listItems", "all");
	await setCheck(page, "allStatuses", true);
	await setCheck(page, "showCallouts", true);
	await page.click("#open");
	await page.waitForTimeout(300);
	const widePopover = await rowsOf(page);
	const widePanel = await panelRowsOf(page);
	check(
		"with every content setting on, the two surfaces still show the same rows",
		widePanel.length > 20 &&
			widePanel.length === widePopover.length &&
			widePanel.every((r, i) => r.text === widePopover[i].text),
		`panel=${widePanel.length} popover=${widePopover.length}`,
	);

	// Folding, in the panel, with the popover's own classes.
	const beforeFold = (await panelRowsOf(page)).length;
	await page.click(".subtle-toc-sidebar .subtle-toc-item.is-foldable .subtle-toc-twisty");
	await page.waitForTimeout(200);
	const folded = (await panelRowsOf(page)).length;
	check("folding in the panel hides a subtree", folded < beforeFold, `${beforeFold} -> ${folded}`);
	await page.click(".subtle-toc-sidebar .subtle-toc-item.is-collapsed .subtle-toc-twisty");
	await page.waitForTimeout(200);
	check(
		"unfolding in the panel restores it",
		(await panelRowsOf(page)).length === beforeFold,
	);

	// The active row tracks the note's scroll position in the panel too.
	await page.$eval("#note-scroll", (e) => (e.scrollTop = 0));
	await page.waitForTimeout(300);
	await page.$eval("#note-scroll", (e) => (e.scrollTop = e.scrollHeight * 0.75));
	await page.waitForTimeout(400);
	const activePanel = await page.$$eval(".subtle-toc-sidebar .subtle-toc-item.is-active", (els) =>
		els.map((e) => e.querySelector(".subtle-toc-item-text")?.textContent?.trim() ?? ""),
	);
	const activePopover = await page.$$eval(".subtle-toc-root .subtle-toc-item.is-active", (els) =>
		els.map((e) => e.querySelector(".subtle-toc-item-text")?.textContent?.trim() ?? ""),
	);
	check(
		"the panel tracks the active heading",
		activePanel.length === 1 && activePanel[0] === activePopover[0],
		`panel=[${activePanel}] popover=[${activePopover}]`,
	);

	// Clicking a panel row navigates the note.
	await page.$eval("#note-scroll", (e) => (e.scrollTop = 0));
	await page.waitForTimeout(250);
	const beforeNav = await page.$eval("#note-scroll", (e) => e.scrollTop);
	await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) => {
		const row = els.find((e) => e.textContent.trim() === "Changelog");
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(700);
	const afterNav = await page.$eval("#note-scroll", (e) => e.scrollTop);
	check("clicking a panel row scrolls the note", afterNav > beforeNav, `${beforeNav} -> ${afterNav}`);

	await page.close();
}

/* ---------------------------------------------- sidebar view: completion -- */

{
	const page = await newPage();
	await page.evaluate(() => {
		window.sim.settings.showTaskCheckboxes = true;
		window.sim.rebuild();
	});
	await page.waitForTimeout(300);

	const strays = await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) =>
		els.filter((e) => e.querySelector(".subtle-toc-task-check.is-actionable")).map((e) => e.textContent.trim()),
	);
	check("the panel offers open tasks a checkbox", strays.length > 0, `${strays.length}`);

	const doneBefore = await page.$$eval(".subtle-toc-sidebar .subtle-toc-item.is-done", (e) => e.length);
	await page.$$eval(".subtle-toc-sidebar .subtle-toc-task-check.is-actionable", (els, i) =>
		els[i].dispatchEvent(new MouseEvent("click", { bubbles: true })), 0);
	// Read the strike before the metadata cache catches up (it lands ~150ms
	// later in the harness, as it does in Obsidian): this is the window the
	// completed-task bridge exists for, and the row has to stay put through it.
	await page.waitForTimeout(60);
	const state = await page.evaluate(() => {
		const row = document.querySelector(".subtle-toc-sidebar .subtle-toc-item.is-done");
		const box = row?.querySelector(".subtle-toc-task-check");
		return {
			done: document.querySelectorAll(".subtle-toc-sidebar .subtle-toc-item.is-done").length,
			text: row?.querySelector(".subtle-toc-item-text")?.textContent?.trim() ?? "",
			checked: box?.getAttribute("aria-checked") ?? null,
			note: window.sim.plugin().noteView.getViewData().includes("- [x]"),
		};
	});
	check(
		"completing a task from the panel strikes the row",
		state.done === doneBefore + 1,
		`done=${state.done} text=${state.text}`,
	);
	check("the completion is announced to assistive tech", state.checked === "true", `${state.checked}`);
	check("and it is written to the note", state.note);

	// The cache catches up with the edit a moment later; the completed task must
	// then drop out of the list on that refresh, without a rebuild.
	await page.waitForTimeout(400);
	const afterSync = await panelRowsOf(page);
	check(
		"the completed task leaves the list once the note is re-read",
		!afterSync.some((r) => r.cls.includes("is-done")) && !afterSync.some((r) => r.text === state.text),
		afterSync.map((r) => r.text).join(", "),
	);

	await page.close();
}

/* ------------------------------------------- sidebar view: empty states --- */

{
	const page = await newPage();
	await page.evaluate(() => window.sim.setNoteView("none"));
	await page.waitForTimeout(250);
	const none = await page.evaluate(() => ({
		rows: document.querySelectorAll(".subtle-toc-sidebar .subtle-toc-item").length,
		msg: document.querySelector(".subtle-toc-sidebar .subtle-toc-empty-msg")?.textContent ?? "",
	}));
	check("no note open: the panel says so", /no note is open/i.test(none.msg), none.msg);
	check("no note open: no rows are rendered", none.rows === 0, `${none.rows}`);

	await page.evaluate(() => window.sim.setNoteView("prose"));
	await page.waitForTimeout(250);
	const prose = await page.evaluate(
		() => document.querySelector(".subtle-toc-sidebar .subtle-toc-empty-msg")?.textContent ?? "",
	);
	check("a note with nothing to outline: the panel says that instead", /nothing to outline/i.test(prose), prose);

	await page.evaluate(() => window.sim.setNoteView("note"));
	await page.waitForTimeout(250);
	check(
		"and it comes back when a note with content is open again",
		(await panelRowsOf(page)).length > 0,
	);

	// The core panes are not touched: the panel is a tab beside them.
	const untouched = await page.evaluate(() => ({
		note: !!document.querySelector("#note-content"),
		dock: !!document.querySelector(".dock-title"),
		dockVisible: getComputedStyle(document.querySelector(".dock-title")).display !== "none",
		hidden: document.querySelectorAll('[style*="display: none"]').length,
	}));
	check(
		"the plugin leaves the surrounding panes alone",
		untouched.note && untouched.dock && untouched.dockVisible && untouched.hidden === 0,
		JSON.stringify(untouched),
	);

	await page.close();
}

/* ------------------------------------------------------- plugin: placement */

/**
 * Which dock the panel is put in, and whether it is revealed, is the whole of
 * `sidebarMode` — and it happens once, at layout-ready, from the settings on
 * disk. So each case boots a fresh page with those settings stored.
 */
{
	const armed = await newPluginPage({ mode: "armed" });
	const calls = await placementOf(armed);
	check(
		"armed: the panel is placed once, focused, without revealing the dock",
		calls.length === 1 &&
			calls[0][0] === "right" &&
			calls[0][1].active === true &&
			calls[0][1].reveal === false,
		JSON.stringify(calls),
	);
	check(
		"armed: the drawer is left closed — swiping in is what opens it",
		await armed.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed),
	);
	check(
		"armed: the panel behind the swipe has the note in it",
		(await armed.$$eval(".subtle-toc-sidebar .subtle-toc-item", (e) => e.length)) > 0,
	);
	check(
		"armed: the note keeps its own floating outline",
		(await armed.$$eval("#note-content .subtle-toc-root", (e) => e.length)) === 1,
	);
	await armed.close();

	const open = await newPluginPage({ mode: "open" });
	const openCalls = await placementOf(open);
	check(
		"open: the dock is revealed at startup",
		openCalls.length === 1 && openCalls[0][1].reveal === true,
		JSON.stringify(openCalls),
	);
	check(
		"open: and it really is open",
		!(await open.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)),
	);
	await open.close();

	const off = await newPluginPage({ mode: "off" });
	const offCalls = await placementOf(off);
	check("off: nothing is placed, nothing is revealed", offCalls.length === 0, JSON.stringify(offCalls));
	check(
		"off: the note still has its overlay, as before this feature existed",
		(await off.$$eval("#note-content .subtle-toc-root", (e) => e.length)) === 1,
	);
	await off.close();

	const left = await newPluginPage({ mode: "armed", side: "left" });
	const leftCalls = await placementOf(left);
	check(
		"armed on the left: the left dock gets it and the right dock does not",
		leftCalls.length === 1 &&
			leftCalls[0][0] === "left" &&
			(await left.$$eval("#dock-body-left .subtle-toc-sidebar", (e) => e.length)) === 1 &&
			(await left.$$eval("#dock-body-right .subtle-toc-sidebar", (e) => e.length)) === 0,
		JSON.stringify(leftCalls),
	);
	await left.close();
}

/* --------------------------------------------------------- plugin: commands */

{
	const page = await newPluginPage({ mode: "off" });
	check(
		"with nothing placed, the dock starts collapsed",
		await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed),
	);

	await page.click("#open");
	await page.waitForTimeout(250);
	check(
		"\"Open in sidebar\" places the view and reveals the dock",
		!(await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)) &&
			(await page.$$eval("#dock-body-right .subtle-toc-sidebar", (e) => e.length)) === 1,
	);
	check(
		"and it focuses the panel, so the note no longer answers as the active view",
		await page.evaluate(
			() => window.pluginSim.app.workspace.activeLeaf?.view?.getViewType() === "subtle-toc-sidebar",
		),
	);
	check(
		"the note in the panel survives the panel taking focus",
		(await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (e) => e.length)) > 0,
	);

	// Toggling while the panel is focused puts the dock away.
	await page.click("#toggle");
	await page.waitForTimeout(200);
	check(
		"\"Toggle sidebar view\" puts the dock away when the panel is up",
		await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed),
	);

	await page.click("#toggle");
	await page.waitForTimeout(200);
	check(
		"and brings it back",
		!(await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)),
	);

	// The note-header button is unchanged: it still belongs to the popover.
	check(
		"the header button was not repointed at the panel",
		(await page.$$eval("#header-actions .view-action", (e) => e.length)) === 0,
	);

	await page.close();
}

/* ---------------------------------------------- plugin: drawer on a phone -- */

{
	// Tablet and phone: the split is the drawer, and tapping a row in the panel
	// has to get it out of the way so the heading is visible.
	const page = await newPluginPage({ mode: "open", device: "phone" });
	check(
		"phone: the panel is placed and the drawer is open",
		!(await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)) &&
			(await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (e) => e.length)) > 0,
	);

	const scrollBefore = await page.$eval("#note-scroll", (e) => e.scrollTop);
	await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) => {
		const row = els.find((e) => e.textContent.trim() === "Risks");
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(700);
	check(
		"phone: tapping a row scrolls the note",
		(await page.$eval("#note-scroll", (e) => e.scrollTop)) > scrollBefore,
	);
	check(
		"phone: and the drawer gets out of the way",
		await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed),
	);

	// With the setting off, the drawer stays where the user put it.
	await page.evaluate(() => {
		window.pluginSim.settings().sidebarCollapseOnTap = false;
		window.pluginSim.app.workspace.rightSplit.expand();
	});
	await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) => {
		const row = els.find((e) => e.textContent.trim() === "Planning");
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(500);
	check(
		"phone: the collapse-on-tap setting is honoured",
		!(await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)),
	);

	// Desktop keeps the dock: it is a panel the user chose to have open. The
	// setting is switched back on first, so this asks about the platform guard
	// rather than about a collapse that the setting already disabled.
	await page.evaluate(() => {
		window.pluginSim.settings().sidebarCollapseOnTap = true;
		window.pluginSim.setPlatform("desktop");
	});
	await page.$$eval(".subtle-toc-sidebar .subtle-toc-item", (els) => {
		const row = els.find((e) => e.textContent.trim() === "Execution");
		row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	await page.waitForTimeout(500);
	check(
		"desktop: a row tap leaves the dock alone",
		!(await page.evaluate(() => window.pluginSim.app.workspace.rightSplit.collapsed)),
	);

	await page.close();
}

/* ------------------------------------------------------------------ report */

check("no uncaught console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

await browser.close();

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
	console.log("\nFailures:");
	for (const f of failures) console.log("  - " + f);
	process.exit(1);
}
