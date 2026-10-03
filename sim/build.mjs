import esbuild from "esbuild";
import process from "process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

/**
 * Builds the simulation harness.
 *
 * The point of the aliases is that the harness bundles the *real* `src/`
 * modules -- overlay, outline, markdown, dom -- and swaps only the host APIs
 * underneath them. What runs in the browser is the plugin's own code.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

const alias = {
	name: "alias-obsidian",
	setup(build) {
		build.onResolve({ filter: /^obsidian$/ }, () => ({
			path: path.join(here, "obsidian-mock.ts"),
		}));
		build.onResolve({ filter: /^@codemirror\/view$/ }, () => ({
			path: path.join(here, "cm-mock.ts"),
		}));
	},
};

// The plugin's real stylesheet, copied in so `sim/` is a self-contained web
// root. Always generated, never edited here -- styles.css at the repo root
// stays the single source of truth.
const copyStyles = () =>
	fs.copyFileSync(path.join(here, "..", "styles.css"), path.join(here, "styles.css"));
copyStyles();

const watch = process.argv[2] === "watch";

const shared = {
	bundle: true,
	format: "iife",
	target: "es2018",
	platform: "browser",
	sourcemap: "inline",
	logLevel: "info",
	plugins: [
		alias,
		{
			name: "copy-styles",
			setup(build) {
				build.onEnd(() => copyStyles());
			},
		},
	],
};

/**
 * Three bundles:
 *   sim.js            the overlay harness (index.html)
 *   settings-probe.js the settings-tab collapse probe (settings-probe.html)
 *   plugin.js         the plugin harness (plugin.html) 
 *
 * Explicit outfiles rather than one outdir, because index.html loads sim.js
 * by name and an entry point called main.ts would otherwise emit main.js.
 */
const contexts = await Promise.all([
	esbuild.context({
		...shared,
		entryPoints: [path.join(here, "main.ts")],
		outfile: path.join(here, "sim.js"),
	}),
	esbuild.context({
		...shared,
		entryPoints: [path.join(here, "settings-probe.ts")],
		outfile: path.join(here, "settings-probe.js"),
	}),
	esbuild.context({
		...shared,
		entryPoints: [path.join(here, "plugin.ts")],
		outfile: path.join(here, "plugin.js"),
	}),
]);

if (watch) {
	await Promise.all(contexts.map((c) => c.watch()));
} else {
	await Promise.all(contexts.map((c) => c.rebuild()));
	await Promise.all(contexts.map((c) => c.dispose()));
}
