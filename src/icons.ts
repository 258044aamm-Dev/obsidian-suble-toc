import { TaskStatusKey } from "./types";

/**
 * The inline SVG icons, drawn by hand rather than via Obsidian's `setIcon` so
 * they render regardless of the host's icon-registry version.
 *
 * Shared by both surfaces of the outline — the floating overlay's chrome and
 * the outline rows themselves — so the sidebar and the popover cannot drift
 * into drawing different glyphs for the same thing.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

type SvgChild = [tag: string, attrs: Record<string, string>];

/** Append an inline Lucide-style icon. */
function createIcon(parent: HTMLElement, children: SvgChild[]): SVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	const attrs: Record<string, string> = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
	};
	for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
	svg.classList.add("subtle-toc-icon");

	for (const [tag, childAttrs] of children) {
		const node = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(childAttrs)) node.setAttribute(k, v);
		svg.appendChild(node);
	}

	parent.appendChild(svg);
	return svg;
}

/** Lucide "square-check". */
export function createCheckboxIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
		["path", { d: "m9 12 2 2 4-4" }],
	]);
}

/** Lucide "heading" (an "H"). */
export function createHeadingIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M6 12h12" }],
		["path", { d: "M6 20V4" }],
		["path", { d: "M18 20V4" }],
	]);
}

/** Lucide "list" — the note-header button and the unified tab. */
export function createListIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M8 6h13" }],
		["path", { d: "M8 12h13" }],
		["path", { d: "M8 18h13" }],
		["path", { d: "M3 6h.01" }],
		["path", { d: "M3 12h.01" }],
		["path", { d: "M3 18h.01" }],
	]);
}

/** Lucide "chevron-right", rotated by CSS when the row is expanded. */
export function createChevronIcon(parent: HTMLElement): void {
	createIcon(parent, [["path", { d: "m9 18 6-6-6-6" }]]);
}

/** Lucide "x" for the mobile sheet's close button. */
export function createCloseIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M18 6 6 18" }],
		["path", { d: "m6 6 12 12" }],
	]);
}

/** The glyph drawn in a task row's status box, per canonical status. */
export const STATUS_GLYPH: Record<TaskStatusKey, string> = {
	todo: "",
	done: "✓",
	inProgress: "/",
	cancelled: "–",
	forwarded: "›",
	question: "?",
	important: "!",
	other: "•",
};
