import { describe, expect, it } from "vitest";
import { buildOutline, flattenAll, flattenVisible, headingsOf, statusKeyFor } from "../src/outline";
import { DEFAULT_SETTINGS, SubtleTocSettings } from "../src/types";

/**
 * Build the slice of CachedMetadata the outline reads, from a plain note.
 * This mirrors what Obsidian's parser produces closely enough to pin
 * behaviour: headings, list items with task chars and parent links, and
 * callout sections.
 */
function parse(note: string) {
	const lines = note.split("\n");
	const headings: any[] = [];
	const listItems: any[] = [];
	const sections: any[] = [];
	/** indent width -> line of the most recent item at that width */
	const openByIndent = new Map<number, number>();
	let listRoot = -1;

	lines.forEach((raw, line) => {
		const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
		if (heading) {
			headings.push({
				heading: heading[2],
				level: heading[1].length,
				position: { start: { line }, end: { line } },
			});
			openByIndent.clear();
			listRoot = -1;
			sections.push({ type: "heading", position: { start: { line }, end: { line } } });
			return;
		}

		if (/^\s*>\s*\[!/.test(raw)) {
			sections.push({ type: "callout", position: { start: { line }, end: { line } } });
			return;
		}

		const list = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s*)?/.exec(raw);
		if (list) {
			const indent = list[1].replace(/\t/g, "    ").length;
			const task = list[2];
			if (listRoot < 0) listRoot = line;
			let parent = -listRoot;
			for (const [width, parentLine] of [...openByIndent.entries()].sort((a, b) => b[0] - a[0])) {
				if (width < indent) {
					parent = parentLine;
					break;
				}
			}
			for (const width of [...openByIndent.keys()]) {
				if (width >= indent) openByIndent.delete(width);
			}
			openByIndent.set(indent, line);
			listItems.push({ task, parent, position: { start: { line }, end: { line } } });
			return;
		}

		if (raw.trim() === "") {
			openByIndent.clear();
			listRoot = -1;
		}
	});

	return { cache: { headings, listItems, sections } as any, lines };
}

function settings(overrides: Partial<SubtleTocSettings> = {}): SubtleTocSettings {
	return { ...DEFAULT_SETTINGS, ...overrides };
}

const NOTE = `# Title

Intro text.

## Section A

- [ ] first task
	- [ ] nested task
- plain bullet
- [x] done task

### Subsection A1

- [/] in progress

## Section B

> [!note] A callout

1. numbered one
2. numbered two
`;

describe("statusKeyFor", () => {
	it("maps the documented characters", () => {
		expect(statusKeyFor(" ")).toBe("todo");
		expect(statusKeyFor("x")).toBe("done");
		expect(statusKeyFor("X")).toBe("done");
		expect(statusKeyFor("/")).toBe("inProgress");
		expect(statusKeyFor("-")).toBe("cancelled");
		expect(statusKeyFor(">")).toBe("forwarded");
		expect(statusKeyFor("?")).toBe("question");
		expect(statusKeyFor("!")).toBe("important");
	});

	it("maps unknown characters to other, and non-tasks to null", () => {
		expect(statusKeyFor("@")).toBe("other");
		expect(statusKeyFor(undefined)).toBeNull();
	});
});

describe("buildOutline", () => {
	it("defaults to headings plus open tasks, matching the previous behaviour", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());
		const flat = flattenAll(tree);

		expect(flat.filter((n) => n.kind === "heading").map((n) => n.text)).toEqual([
			"Title",
			"Section A",
			"Subsection A1",
			"Section B",
		]);
		// Only `[ ]` tasks, because taskStatuses defaults to ["todo"].
		expect(flat.filter((n) => n.kind === "task").map((n) => n.text)).toEqual([
			"first task",
			"nested task",
		]);
		// No bullets, because listItems defaults to "none".
		expect(flat.some((n) => n.kind === "list")).toBe(false);
		// No callouts, because showCallouts defaults to false.
		expect(flat.some((n) => n.kind === "callout")).toBe(false);
	});

	it("nests headings by level", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());

		expect(tree).toHaveLength(1);
		const title = tree[0];
		expect(title.text).toBe("Title");
		expect(title.depth).toBe(0);

		const sections = title.children.filter((n) => n.kind === "heading");
		expect(sections.map((n) => n.text)).toEqual(["Section A", "Section B"]);
		expect(sections[0].depth).toBe(1);

		const sub = sections[0].children.filter((n) => n.kind === "heading");
		expect(sub.map((n) => n.text)).toEqual(["Subsection A1"]);
		expect(sub[0].depth).toBe(2);
	});

	it("attaches tasks to the enclosing heading", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());
		const first = flattenAll(tree).find((n) => n.text === "first task");

		expect(first?.parent?.text).toBe("Section A");
	});

	it("nests a sub-task under its parent task", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());
		const nested = flattenAll(tree).find((n) => n.text === "nested task");

		expect(nested?.parent?.text).toBe("first task");
		expect(nested?.depth).toBe(nested!.parent!.depth + 1);
	});

	it("includes bullets and numbered items when asked", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings({ listItems: "all" }));
		const lists = flattenAll(tree).filter((n) => n.kind === "list");

		expect(lists.map((n) => n.text)).toEqual([
			"plain bullet",
			"numbered one",
			"numbered two",
		]);
	});

	it("limits to top-level list items", () => {
		const nested = parse(`# H\n\n- top\n\t- child\n`);
		const all = buildOutline(nested.cache, nested.lines, settings({ listItems: "all" }));
		const top = buildOutline(nested.cache, nested.lines, settings({ listItems: "top" }));

		expect(flattenAll(all).filter((n) => n.kind === "list").map((n) => n.text)).toEqual([
			"top",
			"child",
		]);
		expect(flattenAll(top).filter((n) => n.kind === "list").map((n) => n.text)).toEqual([
			"top",
		]);
	});

	it("surfaces additional task statuses on request", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(
			cache,
			lines,
			settings({ taskStatuses: ["todo", "done", "inProgress"] }),
		);
		const tasks = flattenAll(tree).filter((n) => n.kind === "task");

		expect(tasks.map((n) => n.text)).toEqual([
			"first task",
			"nested task",
			"done task",
			"in progress",
		]);
		expect(tasks.map((n) => n.statusKey)).toEqual([
			"todo",
			"todo",
			"done",
			"inProgress",
		]);
	});

	it("includes callouts on request", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings({ showCallouts: true }));
		const callouts = flattenAll(tree).filter((n) => n.kind === "callout");

		expect(callouts.map((n) => n.text)).toEqual(["A callout"]);
		expect(callouts[0].parent?.text).toBe("Section B");
	});

	it("honours the heading level range", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings({ minLevel: 2, maxLevel: 2 }));

		expect(headingsOf(tree).map((n) => n.text)).toEqual(["Section A", "Section B"]);
	});

	it("honours show: headings and show: tasks", () => {
		const { cache, lines } = parse(NOTE);

		const onlyHeadings = buildOutline(cache, lines, settings({ show: "headings" }));
		expect(flattenAll(onlyHeadings).every((n) => n.kind === "heading")).toBe(true);

		const onlyTasks = buildOutline(cache, lines, settings({ show: "tasks" }));
		expect(flattenAll(onlyTasks).every((n) => n.kind === "task")).toBe(true);
	});

	it("strips markdown in row text by default", () => {
		const { cache, lines } = parse(`## **Done** [[Project X|PX]]\n`);
		const tree = buildOutline(cache, lines, settings());

		expect(tree[0].text).toBe("Done PX");
		expect(tree[0].rawText).toBe("**Done** [[Project X|PX]]");
	});

	it("keeps raw markdown when stripping is off", () => {
		const { cache, lines } = parse(`## **Done**\n`);
		const tree = buildOutline(cache, lines, settings({ stripMarkdown: false }));

		expect(tree[0].text).toBe("**Done**");
	});

	it("handles a note with no headings", () => {
		const { cache, lines } = parse(`- [ ] orphan task\n- [ ] another\n`);
		const tree = buildOutline(cache, lines, settings());

		expect(tree).toHaveLength(2);
		expect(tree.every((n) => n.parent === null && n.depth === 0)).toBe(true);
	});

	it("handles an empty note", () => {
		expect(buildOutline(null, [], settings())).toEqual([]);
		expect(buildOutline({ headings: [], listItems: [], sections: [] } as any, [], settings())).toEqual([]);
	});

	it("handles a note that skips H1", () => {
		const { cache, lines } = parse(`## Second level\n\n### Third\n`);
		const tree = buildOutline(cache, lines, settings());

		expect(tree).toHaveLength(1);
		expect(tree[0].depth).toBe(0);
		expect(tree[0].children[0].depth).toBe(1);
	});

	it("keeps document order across kinds", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(
			cache,
			lines,
			settings({ listItems: "all", showCallouts: true, taskStatuses: ["todo", "done", "inProgress"] }),
		);
		const linesOut = flattenAll(tree).map((n) => n.line);

		expect(linesOut).toEqual([...linesOut].sort((a, b) => a - b));
	});
});

describe("flattenVisible", () => {
	it("hides the children of a collapsed node", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());
		const sectionA = flattenAll(tree).find((n) => n.text === "Section A")!;

		const open = flattenVisible(tree, new Set(), () => true);
		const closed = flattenVisible(tree, new Set([sectionA.line]), () => true);

		expect(open.length).toBeGreaterThan(closed.length);
		expect(closed.map((n) => n.text)).toContain("Section A");
		expect(closed.map((n) => n.text)).not.toContain("first task");
		expect(closed.map((n) => n.text)).toContain("Section B");
	});

	it("lets children through a filtered-out parent", () => {
		const { cache, lines } = parse(NOTE);
		const tree = buildOutline(cache, lines, settings());
		// Tasks only: the headings are filtered out, but their tasks remain.
		const visible = flattenVisible(tree, new Set(), (n) => n.kind === "task");

		expect(visible.map((n) => n.text)).toEqual(["first task", "nested task"]);
	});
});
