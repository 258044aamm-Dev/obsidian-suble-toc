import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Repo hygiene: the two ways dead code has actually accumulated here.
 *
 * Both checks are on code that ships, and both are deliberately conservative —
 * they report a problem only when they can prove it, because a guard that cries
 * wolf gets deleted, and a guard that cannot fail is worse than none. Each one
 * carries a sanity floor: if the scan stops finding things to scan, the test
 * fails rather than passing vacuously.
 *
 * These replace a manual audit (2026-10-03) that found an unused `isFoldable`,
 * two pre-0.6.0 types, three unused stub classes, a never-read setting key and
 * a harness CSS rule for a class nothing applies.
 */

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every file a symbol or class name could legitimately be referenced from. */
function haystackFiles(): string[] {
	const src = readdirSync(path.join(ROOT, "src")).map((f) => `src/${f}`);
	const sim = readdirSync(path.join(ROOT, "sim")).filter((f) => !f.endsWith(".js"));
	const tests = readdirSync(path.join(ROOT, "tests")).map((f) => `tests/${f}`);
	return [
		...src,
		...sim.map((f) => `sim/${f}`),
		...tests,
		"verify.mjs",
		"esbuild.config.mjs",
		"vitest.config.ts",
	];
}

function readAll(files: string[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const f of files) {
		try {
			out.set(f, read(f));
		} catch {
			// Not every candidate is a readable text file; skipping is fine,
			// the sanity floor below catches a haystack that came out empty.
		}
	}
	return out;
}

/* ---------------------------------------------------------------- exports -- */

/**
 * Exports deliberately allowed to have no importer, with the reason.
 *
 * Keep this empty if you can. An entry is a promise to the next reader that the
 * symbol is there on purpose; `the allow-list cannot rot` below fails if one
 * stops being exported, so this list cannot quietly outlive its reason.
 */
const ALLOWED_UNUSED = new Map<string, string>([]);

const EXPORT_DECL =
	/^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum|let)\s+([A-Za-z_$][\w$]*)/gm;

describe("no module exports something nothing imports", () => {
	it("every export of src/ is referenced outside the file that declares it", () => {
		// Exports are invisible to `tsc --noUnusedLocals`: the compiler sees the
		// export keyword and assumes a consumer exists, which is how an unused
		// `isFoldable()` and two dead interfaces sat in src/ unnoticed.
		const files = haystackFiles();
		const texts = readAll(files);
		const srcFiles = files.filter((f) => f.startsWith("src/"));

		const found = new Map<string, string>(); // symbol -> declaring file
		for (const file of srcFiles) {
			const text = texts.get(file) ?? "";
			for (const m of text.matchAll(EXPORT_DECL)) found.set(m[1], file);
		}

		// Sanity floor: a scan that finds nothing to scan must not pass.
		expect(found.size).toBeGreaterThan(30);

		const unreferenced: string[] = [];
		for (const [symbol, declaredIn] of found) {
			if (ALLOWED_UNUSED.has(symbol)) continue;
			const pattern = new RegExp(`\\b${symbol}\\b`);
			const referenced = [...texts].some(
				([file, text]) => file !== declaredIn && pattern.test(text),
			);
			if (!referenced) unreferenced.push(`${symbol} (${declaredIn})`);
		}

		expect(
			unreferenced,
			"unreferenced exports — delete them, drop the `export`, or add to ALLOWED_UNUSED with a reason",
		).toEqual([]);
	});

	it("the allow-list cannot rot", () => {
		if (ALLOWED_UNUSED.size === 0) return;
		const texts = readAll(haystackFiles().filter((f) => f.startsWith("src/")));
		const declared = new Set(
			[...texts.values()].flatMap((t) =>
				[...t.matchAll(EXPORT_DECL)].map((m) => m[1]),
			),
		);
		for (const symbol of ALLOWED_UNUSED.keys()) {
			expect(declared.has(symbol), `${symbol} is allow-listed but no longer exported`).toBe(true);
		}
	});
});

/* ------------------------------------------------------------------ styles -- */

/**
 * Every `subtle-toc-*` class src/ can emit: literals, plus the prefixes behind
 * template-built names such as `subtle-toc-level-${level}`.
 *
 * Prefixes rather than an enumeration of the NodeKind/TaskStatusKey unions: if
 * someone adds a status, the guard must not need editing, and a guard that
 * needs editing to stay green is a guard that gets weakened.
 *
 * Parsed with TypeScript rather than pattern-matched, because two hand-rolled
 * attempts were wrong in ways that looked fine: a regex treated an apostrophe
 * in a comment ("Obsidian's") as an opening quote and a lone backtick in prose
 * as a template literal, swallowing whole regions of the file, and the scanner
 * that replaced it desynced on nested templates. Both reported zero classes and
 * passed — the same failure mode as the harness that could not see the caret
 * bug. The parser cannot make those mistakes.
 */
function emittedClasses(source: string): { literal: Set<string>; prefixes: Set<string> } {
	const literal = new Set<string>();
	const prefixes = new Set<string>();
	const SENTINEL = "\u0000"; // stands in for an interpolated expression

	const file = ts.createSourceFile(
		"src.ts",
		source,
		ts.ScriptTarget.Latest,
		false,
		ts.ScriptKind.TS,
	);

	/** A template's text with each `${…}` replaced by a sentinel. */
	const shapeOf = (node: ts.TemplateExpression): string =>
		node.head.text + node.templateSpans.map((span) => SENTINEL + span.literal.text).join("");

	const takeShape = (shape: string) => {
		for (const token of shape.split(/\s+/)) {
			if (!token.startsWith("subtle-toc-")) continue;
			const interpolation = token.indexOf(SENTINEL);
			if (interpolation === -1) {
				literal.add(token.replace(/[^A-Za-z0-9_-]+$/, ""));
			} else {
				const prefix = token.slice(0, interpolation);
				if (prefix.length > "subtle-toc-".length) prefixes.add(prefix);
			}
		}
	};

	const walk = (node: ts.Node): void => {
		if (ts.isNoSubstitutionTemplateLiteral(node)) takeShape(node.text);
		else if (ts.isTemplateExpression(node)) takeShape(shapeOf(node));
		else if (ts.isStringLiteral(node)) takeShape(node.text);
		ts.forEachChild(node, walk);
	};
	walk(file);

	return { literal, prefixes };
}

describe("no stylesheet ships a class the plugin cannot produce", () => {
	it("every subtle-toc-* class styled in styles.css is emitted by src/", () => {
		const css = read("styles.css");
		const srcText = [...readAll(haystackFiles().filter((f) => f.startsWith("src/"))).values()].join("\n");

		const styled = new Set(
			[...css.matchAll(/\.(subtle-toc-[A-Za-z0-9_-]+)/g)].map((m) => m[1]),
		);
		const { literal, prefixes } = emittedClasses(srcText);

		// Sanity floors: both sides of the comparison must be non-trivial, or
		// "nothing is dead" would just mean "nothing was scanned".
		expect(styled.size).toBeGreaterThan(30);
		expect(literal.size + prefixes.size).toBeGreaterThan(30);

		const dead = [...styled].filter(
			(cls) => !literal.has(cls) && ![...prefixes].some((p) => cls.startsWith(p)),
		);

		expect(
			dead,
			"styles.css styles classes src/ never emits — delete the rules or fix the name",
		).toEqual([]);
	});
});
