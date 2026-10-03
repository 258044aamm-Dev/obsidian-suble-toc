import type { CachedMetadata } from "./obsidian-mock";

/**
 * A small Markdown parser producing the same `CachedMetadata` shape Obsidian's
 * own parser does, so the harness can feed the real outline builder.
 *
 * It covers what the outline reads: headings, list items (with their task
 * character and parent line), and callout sections.
 */
export function parseNote(note: string): CachedMetadata {
	const lines = note.split("\n");
	const headings: CachedMetadata["headings"] = [];
	const listItems: CachedMetadata["listItems"] = [];
	const sections: CachedMetadata["sections"] = [];

	/** indent width -> line of the most recent item at that width */
	let openByIndent = new Map<number, number>();
	let listRoot = -1;

	const pos = (line: number) => ({ start: { line }, end: { line } });

	lines.forEach((raw, line) => {
		const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
		if (heading) {
			headings.push({ heading: heading[2], level: heading[1].length, position: pos(line) });
			sections.push({ type: "heading", position: pos(line) });
			openByIndent = new Map();
			listRoot = -1;
			return;
		}

		if (/^\s*>\s*\[!/.test(raw)) {
			sections.push({ type: "callout", position: pos(line) });
			return;
		}

		const list = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[(.)\]\s*)?/.exec(raw);
		if (list) {
			const indent = list[1].replace(/\t/g, "    ").length;
			const task = list[2];
			if (listRoot < 0) listRoot = line;

			let parent = -listRoot;
			const widths = [...openByIndent.entries()].sort((a, b) => b[0] - a[0]);
			for (const [width, parentLine] of widths) {
				if (width < indent) {
					parent = parentLine;
					break;
				}
			}
			for (const width of [...openByIndent.keys()]) {
				if (width >= indent) openByIndent.delete(width);
			}
			openByIndent.set(indent, line);

			listItems.push({ task, parent, position: pos(line) });
			return;
		}

		if (raw.trim() === "") {
			openByIndent = new Map();
			listRoot = -1;
		}
	});

	return { headings, listItems, sections };
}
