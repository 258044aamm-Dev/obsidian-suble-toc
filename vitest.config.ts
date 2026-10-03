import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	resolve: {
		alias: {
			// src/settings.ts extends PluginSettingTab, a real runtime value, so
			// the module has to resolve to something. Everything else imported
			// from "obsidian" across src/ is type-only and erased at compile time.
			obsidian: path.resolve(__dirname, "tests/obsidian-stub.ts"),
		},
	},
});
