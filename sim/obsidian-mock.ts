/**
 * A mock of the slice of Obsidian's API that the overlay touches, so the real
 * `overlay.ts` can be bundled and driven in a plain browser page.
 *
 * This is a development harness only -- it is not part of the plugin bundle
 * (esbuild aliases `obsidian` to this file for the sim build only).
 */

/* ---- DOM helpers Obsidian adds to HTMLElement ---------------------------- */

export interface DomElementInfo {
	cls?: string | string[];
	text?: string;
	attr?: Record<string, string>;
}

function applyInfo(el: HTMLElement, info?: DomElementInfo): HTMLElement {
	if (!info) return el;
	if (info.cls) {
		const classes = Array.isArray(info.cls) ? info.cls : info.cls.split(/\s+/);
		for (const c of classes) if (c) el.classList.add(c);
	}
	if (info.text !== undefined) el.textContent = info.text;
	if (info.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttribute(k, v);
	return el;
}

export function installDomHelpers(): void {
	const proto = HTMLElement.prototype as any;
	if (proto.__subtleTocHelpers) return;
	proto.__subtleTocHelpers = true;

	proto.createEl = function (tag: string, info?: DomElementInfo) {
		const el = document.createElement(tag);
		applyInfo(el, info);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (info?: DomElementInfo) {
		return this.createEl("div", info);
	};
	proto.createSpan = function (info?: DomElementInfo) {
		return this.createEl("span", info);
	};
	proto.addClass = function (...cls: string[]) {
		this.classList.add(...cls);
	};
	proto.removeClass = function (...cls: string[]) {
		this.classList.remove(...cls);
	};
	proto.toggleClass = function (cls: string | string[], on: boolean) {
		const list = Array.isArray(cls) ? cls : [cls];
		for (const c of list) this.classList.toggle(c, on);
	};
	proto.hasClass = function (cls: string) {
		return this.classList.contains(cls);
	};
	proto.setText = function (text: string) {
		this.textContent = text;
	};
	proto.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	proto.detach = function () {
		this.remove();
	};
}

/* ---- Platform ------------------------------------------------------------ */

/** Mutable so the harness can switch between device profiles at runtime. */
export const Platform = {
	isDesktop: true,
	isMobile: false,
	isDesktopApp: true,
	isMobileApp: false,
	isIosApp: false,
	isAndroidApp: false,
	isPhone: false,
	isTablet: false,
	isMacOS: false,
	isWin: false,
	isLinux: true,
	isSafari: false,
};

export function setPlatform(profile: "desktop" | "tablet" | "phone"): void {
	Platform.isDesktop = profile === "desktop";
	Platform.isDesktopApp = profile === "desktop";
	Platform.isMobile = profile !== "desktop";
	Platform.isMobileApp = profile !== "desktop";
	Platform.isPhone = profile === "phone";
	Platform.isTablet = profile === "tablet";
}

/* ---- metadata shapes ----------------------------------------------------- */

export interface Pos {
	start: { line: number; col?: number; offset?: number };
	end: { line: number; col?: number; offset?: number };
}
export interface HeadingCache {
	heading: string;
	level: number;
	position: Pos;
}
export interface ListItemCache {
	task?: string;
	parent: number;
	position: Pos;
}
export interface SectionCache {
	type: string;
	position: Pos;
}
export interface CachedMetadata {
	headings?: HeadingCache[];
	listItems?: ListItemCache[];
	sections?: SectionCache[];
}

export class TFile {
	constructor(public path: string) {}
}

/* ---- app / vault --------------------------------------------------------- */

export class App {
	metadataCache = {
		cache: null as CachedMetadata | null,
		getFileCache(_file: TFile | null) {
			return this.cache;
		},
	};
	vault = {
		async process(_file: TFile, fn: (data: string) => string) {
			return fn("");
		},
	};
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class MarkdownView {}

export type IconName = string;
