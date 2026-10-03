import { describe, expect, it } from "vitest";
import {
	indentWidth,
	parseCalloutHeader,
	stripListMarkup,
	toDisplayText,
} from "../src/markdown";

describe("toDisplayText", () => {
	it("leaves plain text untouched", () => {
		expect(toDisplayText("Just a heading")).toBe("Just a heading");
	});

	it("unwraps emphasis", () => {
		expect(toDisplayText("**bold**")).toBe("bold");
		expect(toDisplayText("__bold__")).toBe("bold");
		expect(toDisplayText("*italic*")).toBe("italic");
		expect(toDisplayText("_italic_")).toBe("italic");
		expect(toDisplayText("***both***")).toBe("both");
		expect(toDisplayText("==highlight==")).toBe("highlight");
		expect(toDisplayText("~~strike~~")).toBe("strike");
	});

	it("resolves wikilinks, preferring the alias", () => {
		expect(toDisplayText("[[Project X]]")).toBe("Project X");
		expect(toDisplayText("[[Project X|PX]]")).toBe("PX");
		expect(toDisplayText("see [[a]] and [[b|B]]")).toBe("see a and B");
	});

	it("resolves markdown links and images", () => {
		expect(toDisplayText("[text](https://example.com)")).toBe("text");
		expect(toDisplayText("![alt](img.png)")).toBe("alt");
		expect(toDisplayText("![](img.png)")).toBe("");
		expect(toDisplayText("![[embed.png]]")).toBe("embed.png");
	});

	it("unwraps inline code", () => {
		expect(toDisplayText("`code`")).toBe("code");
		expect(toDisplayText("run `npm test` now")).toBe("run npm test now");
	});

	it("handles the combined case from the plan", () => {
		expect(toDisplayText("**Done** [[Project X|PX]] #tag", { stripTags: true })).toBe(
			"Done PX",
		);
	});

	it("keeps tags unless asked to strip them", () => {
		expect(toDisplayText("Heading #tag")).toBe("Heading #tag");
		expect(toDisplayText("Heading #tag", { stripTags: true })).toBe("Heading");
		expect(toDisplayText("#nested/tag done", { stripTags: true })).toBe("done");
	});

	it("does not treat a heading marker inside text as a tag", () => {
		expect(toDisplayText("C# basics", { stripTags: true })).toBe("C# basics");
	});

	it("strips dataview inline fields and task emoji metadata", () => {
		expect(toDisplayText("Write docs [due:: 2026-01-01]")).toBe("Write docs");
		expect(toDisplayText("Write docs \u{1F4C5} 2026-01-01")).toBe("Write docs");
		expect(toDisplayText("Write docs \u23EB")).toBe("Write docs");
	});

	it("keeps metadata when asked", () => {
		expect(toDisplayText("Write docs [due:: 2026-01-01]", { stripTaskMetadata: false })).toBe(
			"Write docs [due:: 2026-01-01]",
		);
	});

	it("drops html tags, footnotes and block ids", () => {
		expect(toDisplayText("line<br>break")).toBe("linebreak");
		expect(toDisplayText("claim[^1]")).toBe("claim");
		expect(toDisplayText("text ^block-id")).toBe("text");
	});

	it("collapses whitespace left behind", () => {
		expect(toDisplayText("a  **b**   c")).toBe("a b c");
	});

	it("handles empty and whitespace input", () => {
		expect(toDisplayText("")).toBe("");
		expect(toDisplayText("   ")).toBe("");
	});

	it("leaves unmatched markers alone rather than mangling them", () => {
		expect(toDisplayText("2 * 3 = 6")).toBe("2 * 3 = 6");
		expect(toDisplayText("a_b_c")).toBe("abc");
	});

	it("uses no lookbehind, which crashes older iOS", () => {
		const source = String(toDisplayText);
		expect(source).not.toContain("(?<");
	});
});

describe("stripListMarkup", () => {
	it("strips bullet markers", () => {
		expect(stripListMarkup("- item")).toBe("item");
		expect(stripListMarkup("* item")).toBe("item");
		expect(stripListMarkup("+ item")).toBe("item");
	});

	it("strips numbered markers", () => {
		expect(stripListMarkup("1. item")).toBe("item");
		expect(stripListMarkup("12) item")).toBe("item");
	});

	it("strips checkboxes of any status", () => {
		expect(stripListMarkup("- [ ] todo")).toBe("todo");
		expect(stripListMarkup("- [x] done")).toBe("done");
		expect(stripListMarkup("- [/] partial")).toBe("partial");
		expect(stripListMarkup("1. [>] forwarded")).toBe("forwarded");
	});

	it("handles indentation", () => {
		expect(stripListMarkup("    - [ ] nested")).toBe("nested");
		expect(stripListMarkup("\t\t- deep")).toBe("deep");
	});

	it("handles tasks inside callouts", () => {
		expect(stripListMarkup("> - [ ] quoted task")).toBe("quoted task");
	});

	it("leaves a non-list line alone", () => {
		expect(stripListMarkup("just text")).toBe("just text");
	});
});

describe("parseCalloutHeader", () => {
	it("parses a titled callout", () => {
		expect(parseCalloutHeader("> [!note] Remember this")).toEqual({
			type: "note",
			title: "Remember this",
		});
	});

	it("parses foldable markers", () => {
		expect(parseCalloutHeader("> [!warning]+ Careful")).toEqual({
			type: "warning",
			title: "Careful",
		});
		expect(parseCalloutHeader("> [!tip]- Hidden")).toEqual({
			type: "tip",
			title: "Hidden",
		});
	});

	it("falls back to the capitalised type when untitled", () => {
		expect(parseCalloutHeader("> [!info]")).toEqual({ type: "info", title: "Info" });
	});

	it("returns null for a plain blockquote", () => {
		expect(parseCalloutHeader("> just a quote")).toBeNull();
	});
});

describe("indentWidth", () => {
	it("counts spaces and tabs", () => {
		expect(indentWidth("no indent")).toBe(0);
		expect(indentWidth("  two")).toBe(2);
		expect(indentWidth("\tone tab")).toBe(4);
		expect(indentWidth("\t  mixed")).toBe(6);
	});
});
