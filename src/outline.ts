import { CachedMetadata } from "obsidian";
import { indentWidth, parseCalloutHeader, stripListMarkup, toDisplayText } from "./markdown";
import { OutlineNode, NodeKind, SubtleTocSettings, TaskStatusKey } from "./types";

/**
 * Builds the single outline tree the whole UI renders from.
 *
 * Before this module the plugin kept two parallel flat arrays (headings and
 * open tasks) with two renderers, two navigation paths and no parent/child
 * relationship anywhere. Every content type we wanted to add -- bullets,
 * numbered lists, non-default task statuses, callouts -- needed its own array,
 * its own builder and its own branch in every consumer.
 *
 * Everything now merges into one document-ordered tree of `OutlineNode`, which
 * is what makes nesting, collapsing and keyboard navigation expressible at all.
 */

/** Canonical status for a raw checkbox character. */
export function statusKeyFor(raw: string | undefined): TaskStatusKey | null {
	if (raw === undefined) return null;
	switch (raw) {
		case " ":
			return "todo";
		case "x":
		case "X":
			return "done";
		case "/":
			return "inProgress";
		case "-":
			return "cancelled";
		case ">":
			return "forwarded";
		case "?":
			return "question";
		case "!":
			return "important";
		default:
			return "other";
	}
}

/** Human label for a status, used in tooltips and settings. */
export const STATUS_LABELS: Record<TaskStatusKey, string> = {
	todo: "To do",
	done: "Done",
	inProgress: "In progress",
	cancelled: "Cancelled",
	forwarded: "Forwarded",
	question: "Question",
	important: "Important",
	other: "Other",
};

/** A flat entry collected from one of the sources, before tree assembly. */
interface RawEntry {
	kind: NodeKind;
	line: number;
	/** Heading level 1-6; for list items the indent width; 0 for callouts. */
	rawLevel: number;
	rawText: string;
	text: string;
	status?: string;
	statusKey?: TaskStatusKey;
	/** `ListItemCache.parent` -- parent line, or negative for a root item. */
	listParent?: number;
}

/**
 * A node's identity is its kind and line, which is stable across rebuilds --
 * that is what lets `refresh()` reconcile existing rows instead of destroying
 * and recreating the entire list on every keystroke. Two nodes can never share
 * a line, so the pair is unique.
 */
function nodeId(kind: NodeKind, line: number): string {
	return `${kind}:${line}`;
}

function makeNode(entry: RawEntry, depth: number, parent: OutlineNode | null): OutlineNode {
	return {
		id: nodeId(entry.kind, entry.line),
		kind: entry.kind,
		depth,
		rawLevel: entry.rawLevel,
		text: entry.text,
		rawText: entry.rawText,
		line: entry.line,
		status: entry.status,
		statusKey: entry.statusKey,
		children: [],
		parent,
	};
}

/**
 * Collect heading entries. Unlike the other sources these are always gathered
 * in full: the min/max level filter is applied here, but the result still
 * defines the skeleton every other node hangs from.
 */
function collectHeadings(cache: CachedMetadata | null, s: SubtleTocSettings): RawEntry[] {
	if (s.show === "tasks") return [];
	return (cache?.headings ?? [])
		.filter((h) => h.level >= s.minLevel && h.level <= s.maxLevel)
		.map((h) => ({
			kind: "heading" as const,
			line: h.position.start.line,
			rawLevel: h.level,
			rawText: h.heading,
			text: displayText(h.heading, s) || "(untitled)",
		}));
}

/**
 * Collect list items: tasks of any status, and -- when enabled -- plain
 * bullets and numbered items.
 *
 * Note that `cache.listItems` already contains every list item in the note
 * regardless of whether it carries a checkbox; the previous implementation
 * fetched all of them and then discarded the non-task ones on a single filter
 * line. Supporting bullets is therefore a filtering change, not new I/O.
 */
function collectListItems(
	cache: CachedMetadata | null,
	lines: string[],
	s: SubtleTocSettings,
): RawEntry[] {
	if (s.show === "headings" && s.listItems === "none") return [];
	const items = cache?.listItems ?? [];
	const out: RawEntry[] = [];

	for (const item of items) {
		const line = item.position.start.line;
		const raw = lines[line] ?? "";
		const isTask = item.task !== undefined;

		if (isTask) {
			if (s.show === "headings") continue;
			const statusKey = statusKeyFor(item.task);
			if (!statusKey || !s.taskStatuses.includes(statusKey)) continue;
			out.push({
				kind: "task",
				line,
				rawLevel: indentWidth(raw),
				rawText: raw,
				text: displayText(stripListMarkup(raw), s) || "(empty task)",
				status: item.task,
				statusKey,
				listParent: item.parent,
			});
			continue;
		}

		if (s.listItems === "none") continue;
		// `parent` is negative for a root-level item, which is how we tell a
		// top-level bullet from a nested one without re-parsing indentation.
		if (s.listItems === "top" && item.parent >= 0) continue;
		const text = displayText(stripListMarkup(raw), s);
		// Skip items that are empty once their markup is gone -- they are
		// usually spacing in hand-formatted lists and add only noise.
		if (!text) continue;
		out.push({
			kind: "list",
			line,
			rawLevel: indentWidth(raw),
			rawText: raw,
			text,
			listParent: item.parent,
		});
	}

	return out;
}

/** Collect callout headers (`> [!note] Title`) from the section list. */
function collectCallouts(
	cache: CachedMetadata | null,
	lines: string[],
	s: SubtleTocSettings,
): RawEntry[] {
	if (!s.showCallouts || s.show === "tasks") return [];
	const out: RawEntry[] = [];
	for (const section of cache?.sections ?? []) {
		if (section.type !== "callout") continue;
		const line = section.position.start.line;
		const parsed = parseCalloutHeader(lines[line] ?? "");
		if (!parsed) continue;
		out.push({
			kind: "callout",
			line,
			rawLevel: 0,
			rawText: lines[line] ?? "",
			text: displayText(parsed.title, s) || parsed.type,
		});
	}
	return out;
}

function displayText(raw: string, s: SubtleTocSettings): string {
	if (!s.stripMarkdown) return raw.trim();
	return toDisplayText(raw, {
		stripTags: s.stripTags,
		stripTaskMetadata: true,
	});
}

/**
 * Merge every source into one document-ordered tree.
 *
 * Headings nest by level. Everything else attaches to the nearest preceding
 * heading, and list items additionally nest among themselves using the
 * `parent` line that Obsidian's cache already records -- so a sub-task sits
 * under its parent task rather than being flattened next to it.
 */
export function buildOutline(
	cache: CachedMetadata | null,
	lines: string[],
	settings: SubtleTocSettings,
): OutlineNode[] {
	const entries = [
		...collectHeadings(cache, settings),
		...collectCallouts(cache, lines, settings),
		...collectListItems(cache, lines, settings),
	].sort((a, b) => a.line - b.line);

	const roots: OutlineNode[] = [];
	/** Open heading ancestors, deepest last. */
	const headingStack: OutlineNode[] = [];
	/** Node for each list item line, so children can find their parent. */
	const byLine = new Map<number, OutlineNode>();

	const attach = (node: OutlineNode, parent: OutlineNode | null) => {
		node.parent = parent;
		if (parent) parent.children.push(node);
		else roots.push(node);
	};

	for (const entry of entries) {
		if (entry.kind === "heading") {
			while (
				headingStack.length > 0 &&
				headingStack[headingStack.length - 1].rawLevel >= entry.rawLevel
			) {
				headingStack.pop();
			}
			const parent = headingStack[headingStack.length - 1] ?? null;
			const node = makeNode(entry, headingStack.length, parent);
			attach(node, parent);
			headingStack.push(node);
			continue;
		}

		const headingParent = headingStack[headingStack.length - 1] ?? null;

		// List items and tasks: prefer the recorded list parent so nesting
		// survives; fall back to the enclosing heading for root-level items.
		//
		// `ListItemCache.parent` is the parent's line, or the *negative* of the
		// list's first line for a root item. That encoding has a trap: a list
		// starting on line 0 yields `-0`, and `-0 >= 0` is true in JavaScript,
		// so a naive sign test reads every root item in such a list as a child
		// of whatever sits on line 0. `Object.is` is the only way to tell the
		// two zeroes apart. The `>= entry.line` guard is belt-and-braces
		// against a self- or forward-reference.
		let parent = headingParent;
		const listParent = entry.listParent;
		const isRootItem =
			listParent === undefined ||
			listParent < 0 ||
			Object.is(listParent, -0) ||
			listParent >= entry.line;
		if (!isRootItem) {
			parent = byLine.get(listParent) ?? headingParent;
		}

		const depth = parent ? parent.depth + 1 : 0;
		const node = makeNode(entry, depth, parent);
		attach(node, parent);
		byLine.set(entry.line, node);
	}

	return roots;
}

/** Depth-first walk of the tree in document order. */
export function walk(nodes: OutlineNode[], visit: (node: OutlineNode) => void): void {
	for (const node of nodes) {
		visit(node);
		if (node.children.length > 0) walk(node.children, visit);
	}
}

/** Every node, flattened in document order, ignoring collapse state. */
export function flattenAll(nodes: OutlineNode[]): OutlineNode[] {
	const out: OutlineNode[] = [];
	walk(nodes, (n) => out.push(n));
	return out;
}

/**
 * The rows actually rendered: a depth-first walk that does not descend into a
 * collapsed node, and that skips nodes filtered out by the active tab.
 */
export function flattenVisible(
	nodes: OutlineNode[],
	collapsed: ReadonlySet<number>,
	accept: (node: OutlineNode) => boolean,
): OutlineNode[] {
	const out: OutlineNode[] = [];
	const visit = (list: OutlineNode[]) => {
		for (const node of list) {
			const keep = accept(node);
			if (keep) out.push(node);
			// A filtered-out node still lets its children through, otherwise
			// turning off bullets would also hide the tasks nested under them.
			if (node.children.length > 0 && (!keep || !collapsed.has(node.line))) {
				visit(node.children);
			}
		}
	};
	visit(nodes);
	return out;
}

/** Headings only, in document order -- the minimap and active tracking use this. */
export function headingsOf(nodes: OutlineNode[]): OutlineNode[] {
	return flattenAll(nodes).filter((n) => n.kind === "heading");
}

/** Count of nodes matching a predicate. */
export function countOf(nodes: OutlineNode[], match: (n: OutlineNode) => boolean): number {
	let n = 0;
	walk(nodes, (node) => {
		if (match(node)) n++;
	});
	return n;
}

