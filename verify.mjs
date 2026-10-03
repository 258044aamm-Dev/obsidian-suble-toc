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
	page.$$eval(".subtle-toc-item", (els) =>
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
	await page.click(".subtle-toc-item.subtle-toc-kind-heading.is-foldable .subtle-toc-twisty");
	await page.waitForTimeout(250);
	const after = (await rowsOf(page)).length;
	check("folding hides descendants", after < before, `${before} -> ${after}`);
	await page.click(".subtle-toc-item.subtle-toc-kind-heading.is-collapsed .subtle-toc-twisty");
	await page.waitForTimeout(250);
	check("unfolding restores them", (await rowsOf(page)).length === before);

	// Navigation
	await page.click("#open");
	await page.waitForTimeout(200);
	const scrollBefore = await page.$eval("#note-scroll", (e) => e.scrollTop);
	const target = await page.$$eval(".subtle-toc-item", (els) => {
		const i = els.findIndex((e) => e.textContent.trim() === "Changelog");
		return i;
	});
	await page.$$eval(
		".subtle-toc-item",
		(els, i) => els[i].dispatchEvent(new MouseEvent("click", { bubbles: true })),
		target,
	);
	await page.waitForTimeout(700);
	const scrollAfter = await page.$eval("#note-scroll", (e) => e.scrollTop);
	check("clicking a row scrolls the note", scrollAfter > scrollBefore, `${scrollBefore} -> ${scrollAfter}`);

	const activeText = await page
		.$eval(".subtle-toc-item.is-active", (e) => e.textContent.trim())
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
	await page.$$eval(".subtle-toc-tab", (els) => {
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

	const twisties = await page.$$eval(".subtle-toc-item", (els) =>
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
	await page.$$eval(".subtle-toc-item", (els) => {
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

	// Two axes, because each one hid a bug that reached the user.
	//
	//   fixture  desktop vs mobile. Obsidian stacks a settings row on mobile
	//            unless it carries a control modifier class, which is what put
	//            the caret under the title.
	//   shape    where the header sits relative to the group's list element.
	//            Obsidian owns that markup and the harness cannot see it.
	for (const fixture of ["desktop", "mobile"]) {
		await page.setViewportSize(
			fixture === "mobile" ? { width: 390, height: 844 } : { width: 900, height: 900 },
		);
		await page.evaluate((f) => window.probe.setFixture(f), fixture);

		for (const shape of ["A", "B"]) {
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

			// Geometry. The caret must be beside the title, not beneath it.
			for (const id of ["content", "behavior"]) {
				const geo = await geom(id);
				check(
					`[${tag}] ${id} caret sits right of the title`,
					geo.caretLeft >= geo.titleRight,
					`caretLeft=${geo.caretLeft} titleRight=${geo.titleRight}`,
				);
				check(
					`[${tag}] ${id} caret shares the title's line`,
					Math.abs(geo.caretMidY - geo.titleMidY) < 2,
					`caretMidY=${geo.caretMidY} titleMidY=${geo.titleMidY}`,
				);
				// Laid out as a row the content is about the taller of the two;
				// stacked it is their sum. No magic threshold, so this holds on
				// desktop and mobile alike.
				check(
					`[${tag}] ${id} header is one row, not two stacked`,
					geo.contentHeight < geo.stackedHeight,
					`content=${geo.contentHeight} stacked=${geo.stackedHeight} rowHeight=${geo.rowHeight}`,
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
			await page.click(`${g("content")} ${HEADER} .setting-item-info`);
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
					Math.abs(openGeo.caretMidY - openGeo.titleMidY) < 2,
				`caretLeft=${openGeo.caretLeft} titleRight=${openGeo.titleRight}`,
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
				await page.click(`${g(id)} ${HEADER}`);
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
			await page.evaluate(() => window.probe.renderPage({ shape: "A" }));
			await page.screenshot({
				path: `${SHOT_DIR}/07-settings-groups-${fixture}.png`,
				fullPage: true,
			});
		}
	}

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
