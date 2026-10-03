/**
 * Minimal CodeMirror 6 stand-in for the simulation harness.
 *
 * `dom.ts` uses only a narrow slice of the real API -- line geometry, the
 * scroll element, and `scrollIntoView` effects -- so the harness backs those
 * with real DOM measurements of the rendered fake note. That keeps the
 * editing-mode scroll and active-heading code paths genuinely exercised
 * rather than stubbed out.
 */

export interface LineInfo {
	from: number;
	number: number;
}

export interface BlockInfo {
	top: number;
	height: number;
}

export class MockEditorView {
	constructor(
		public scrollDOM: HTMLElement,
		private lineEls: HTMLElement[],
	) {}

	/** Positions in the harness are simply 0-based line indices. */
	get state() {
		const lineEls = this.lineEls;
		return {
			doc: {
				get lines() {
					return lineEls.length;
				},
				/** CodeMirror lines are 1-based. */
				line(n: number): LineInfo {
					return { from: n - 1, number: n };
				},
			},
		};
	}

	lineBlockAt(pos: number): BlockInfo {
		const el = this.lineEls[pos];
		if (!el) return { top: 0, height: 0 };
		return { top: el.offsetTop, height: el.offsetHeight };
	}

	domAtPos(pos: number): { node: Node } {
		const el = this.lineEls[pos] ?? this.scrollDOM;
		return { node: el };
	}

	dispatch(spec: { selection?: { anchor: number }; effects?: unknown }): void {
		const effect = spec.effects as { pos?: number } | undefined;
		if (effect && typeof effect.pos === "number") {
			const block = this.lineBlockAt(effect.pos);
			this.scrollDOM.scrollTop = Math.max(0, block.top - 12);
		}
	}
}

export const EditorView = {
	scrollIntoView(pos: number, _options?: { y?: string; yMargin?: number }) {
		return { pos };
	},
};
