/**
 * Markdown -> plain text for outline rows.
 *
 * Headings and list items come out of the metadata cache as raw Markdown, so a
 * heading like `## **Done** [[Project X|PX]] #tag` would otherwise render with
 * all of its syntax visible. This module reduces a single line of inline
 * Markdown to the text a reader would see.
 *
 * Two hard constraints:
 *  - **No lookbehind.** `(?<=...)` throws a SyntaxError at parse time on iOS
 *    versions still in the wild, which would take the whole plugin down on
 *    load. Everything here uses capture groups instead.
 *  - **Order matters.** Rules run outside-in (embeds before links, bold before
 *    italic) because the markers overlap. The order below is load-bearing;
 *    the unit tests in tests/markdown.test.ts pin it.
 */

/** `![[Note|Alias]]` / `![[Note]]` -> alias, else the note name. */
const EMBED = /!\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;
/** `[[Note|Alias]]` / `[[Note]]` -> alias, else the note name. */
const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]*?))?\]\]/g;
/** `![alt](url)` -> alt text (often empty, which is correct). */
const IMAGE = /!\[([^\]]*?)\]\([^)]*?\)/g;
/** `[text](url)` -> text. */
const MDLINK = /\[([^\]]*?)\]\([^)]*?\)/g;
/** `[^1]` footnote reference -> dropped. */
const FOOTNOTE_REF = /\[\^[^\]]+?\]/g;
/** Dataview inline field: `[due:: 2026-01-01]` or `(due:: 2026-01-01)`. */
const DATAVIEW_BRACKET = /\[[^[\]]*?::[^[\]]*?\]/g;
const DATAVIEW_PAREN = /\([^()]*?::[^()]*?\)/g;
/** `` `code` `` -> code (one backtick pair; the content is shown verbatim). */
const INLINE_CODE = /`+([^`]+?)`+/g;
/** `***both***` / `___both___`. Must run before bold and italic. */
const BOLD_ITALIC = /(\*\*\*|___)(.+?)\1/g;
/** `**bold**` / `__bold__`. Must run before italic. */
const BOLD = /(\*\*|__)(.+?)\1/g;
/** `*italic*` / `_italic_`. */
const ITALIC = /(\*|_)([^*_]+?)\1/g;
/** `==highlight==`. */
const HIGHLIGHT = /==(.+?)==/g;
/** `~~strike~~`. */
const STRIKE = /~~(.+?)~~/g;
/** Raw HTML tags, e.g. `<br>`, `<span class="x">`. */
const HTML_TAG = /<\/?[a-zA-Z][^>]*?>/g;
/** Trailing `^block-id`. */
const BLOCK_ID = /\s*\^[A-Za-z0-9-]+\s*$/;
/** `#tag` / `#nested/tag`, only when preceded by start-of-string or space. */
const TAG = /(^|\s)#[^\s#)[\]]+/g;

/**
 * Tasks-plugin metadata: an emoji signifier optionally followed by a date.
 * Listed explicitly rather than matched as "any emoji" so that emoji the user
 * typed as part of the text survive.
 */
const TASK_EMOJI_WITH_DATE =
	/[\u{1F4C5}\u{1F4C6}\u{1F6EB}\u{2705}\u{274C}\u{23F3}\u{1F4C8}]\uFE0F?\s*\d{4}-\d{2}-\d{2}/gu;
/** Bare priority / recurrence signifiers with no date attached. */
const TASK_EMOJI_BARE =
	/[\u{23EB}\u{23E9}\u{23EC}\u{1F53C}\u{1F53D}\u{1F501}\u{1F6AB}\u{2049}\u{1F3C1}]\uFE0F?/gu;
/** Dataview-style `[priority:: high]` is already covered by DATAVIEW_BRACKET. */

export interface StripOptions {
	/** Remove `#tags` from the displayed text. */
	stripTags?: boolean;
	/** Remove Tasks-plugin emoji metadata and Dataview inline fields. */
	stripTaskMetadata?: boolean;
}

/**
 * Reduce one line of inline Markdown to its readable text.
 *
 * Returns the input unchanged when it contains no Markdown syntax, so the
 * common case costs only the regex scans and no allocation beyond them.
 */
export function toDisplayText(raw: string, options: StripOptions = {}): string {
	if (!raw) return "";
	const { stripTags = false, stripTaskMetadata = true } = options;

	let out = raw;

	// Structural: embeds and links before anything that touches brackets.
	out = out.replace(EMBED, (_m, target: string, alias?: string) =>
		(alias ?? target).trim(),
	);
	out = out.replace(IMAGE, (_m, alt: string) => alt);
	out = out.replace(WIKILINK, (_m, target: string, alias?: string) =>
		(alias ?? target).trim(),
	);
	out = out.replace(MDLINK, (_m, text: string) => text);
	out = out.replace(FOOTNOTE_REF, "");

	if (stripTaskMetadata) {
		out = out.replace(DATAVIEW_BRACKET, "");
		out = out.replace(DATAVIEW_PAREN, "");
		out = out.replace(TASK_EMOJI_WITH_DATE, "");
		out = out.replace(TASK_EMOJI_BARE, "");
	}

	// Emphasis: outside-in.
	out = out.replace(INLINE_CODE, (_m, code: string) => code);
	out = out.replace(BOLD_ITALIC, (_m, _marker: string, text: string) => text);
	out = out.replace(BOLD, (_m, _marker: string, text: string) => text);
	out = out.replace(ITALIC, (_m, _marker: string, text: string) => text);
	out = out.replace(HIGHLIGHT, (_m, text: string) => text);
	out = out.replace(STRIKE, (_m, text: string) => text);

	out = out.replace(HTML_TAG, "");
	out = out.replace(BLOCK_ID, "");

	if (stripTags) {
		out = out.replace(TAG, (_m, lead: string) => lead);
	}

	// Collapse the whitespace the removals leave behind.
	return out.replace(/\s+/g, " ").trim();
}

/** Leading list marker + checkbox of a task line, e.g. `- [ ] ` or `1. [ ] `. */
const TASK_MARKUP = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*/;
/** Leading list marker with no checkbox, e.g. `- ` or `1. `. */
const LIST_MARKUP = /^\s*(?:[-*+]|\d+[.)])\s+/;
/** Leading blockquote / callout markers, e.g. `> ` or `> > `. */
const QUOTE_MARKUP = /^\s*(?:>\s?)+/;

/** Strip the leading list and checkbox markup so only the item's text remains. */
export function stripListMarkup(raw: string): string {
	const withoutQuote = raw.replace(QUOTE_MARKUP, "");
	const withoutTask = withoutQuote.replace(TASK_MARKUP, "");
	if (withoutTask !== withoutQuote) return withoutTask.trim();
	return withoutQuote.replace(LIST_MARKUP, "").trim();
}

/** `> [!note]+ Title` -> `{ type: "note", title: "Title" }`, or null. */
export function parseCalloutHeader(
	raw: string,
): { type: string; title: string } | null {
	const body = raw.replace(QUOTE_MARKUP, "");
	const m = /^\[!([^\]]+)\][+-]?\s*(.*)$/.exec(body);
	if (!m) return null;
	const type = m[1].trim().toLowerCase();
	const title = m[2].trim();
	// An untitled callout falls back to its type, capitalised, which is what
	// Obsidian itself renders as the header.
	return { type, title: title || type.charAt(0).toUpperCase() + type.slice(1) };
}

/** Indent width of a line in spaces, counting a tab as `tabSize`. */
export function indentWidth(raw: string, tabSize = 4): number {
	let width = 0;
	for (const ch of raw) {
		if (ch === " ") width += 1;
		else if (ch === "\t") width += tabSize;
		else break;
	}
	return width;
}
