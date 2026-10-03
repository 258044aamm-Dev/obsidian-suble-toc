/**
 * Minimal stand-in for the `obsidian` module, aliased in vitest.config.ts.
 *
 * `src/settings.ts` extends PluginSettingTab, which is a real runtime value,
 * so the settings tests cannot run without something to extend. Only the
 * members the settings tab actually touches are implemented; everything else
 * in the module is type-only and gets erased at compile time.
 */

export class PluginSettingTab {
	app: unknown;
	plugin: unknown;
	containerEl: unknown;
	/** Records calls so tests can assert the tab asked for a re-render. */
	updateCalls = 0;
	hideCalls = 0;

	constructor(app: unknown, plugin: unknown) {
		this.app = app;
		this.plugin = plugin;
	}

	update(): void {
		this.updateCalls++;
	}

	hide(): void {
		this.hideCalls++;
	}

	display(): void {
		/* never called under the declarative API */
	}

	refreshDomState(): void {
		/* no-op */
	}
}
