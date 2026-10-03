/** A navigable target: enough for scrollToTarget to scroll/flash it. */
export type NavTarget = { text: string; line: number };

/** What an outline row was built from. */
export type NodeKind = "heading" | "task" | "list" | "callout";

/** Canonical task statuses, mapped from the raw checkbox character. */
export type TaskStatusKey =
	| "todo"
	| "done"
	| "inProgress"
	| "cancelled"
	| "forwarded"
	| "question"
	| "important"
	| "other";

/**
 * One row of the outline. Headings, tasks, bullets and callouts are all the
 * same shape, which is what lets a single renderer, a single navigation path
 * and a single keyboard walk serve all of them.
 */
export interface OutlineNode {
	/** Stable within one build; used as a DOM reconciliation key. */
	id: string;
	kind: NodeKind;
	/** Visual nesting depth, normalised across kinds. */
	depth: number;
	/** Heading level 1-6, list indent width, or 0 for callouts. */
	rawLevel: number;
	/** Display text, with Markdown reduced to what a reader would see. */
	text: string;
	/** The original Markdown, kept for tooltips and future search. */
	rawText: string;
	/** 0-based line number in the document. */
	line: number;
	/** Raw checkbox character for tasks, e.g. `" "`, `"x"`, `"/"`. */
	status?: string;
	/** Canonical status for tasks. */
	statusKey?: TaskStatusKey;
	children: OutlineNode[];
	parent: OutlineNode | null;
}

export type TocSide = "right" | "left";
export type TocTrigger = "hover" | "click";
export type TocShow = "headings" | "tasks" | "both";
export type TocDefaultTab = "headings" | "tasks";
/** Unified tree, or the original two-tab split. */
export type TocOutlineMode = "unified" | "tabs";
/** Which plain list items to surface. */
export type TocListItems = "none" | "top" | "all";
/** When to add the note-header button. */
export type TocHeaderButton = "auto" | "always" | "never";
/** Whether the sidebar/drawer view is placed automatically. */
export type TocSidebarMode = "off" | "armed" | "open";

export interface SubtleTocSettings {
	/** Which content to surface: headings, open tasks, or both. */
	show: TocShow;
	/** Tab that leads the tab bar and is selected on the first open. */
	defaultTab: TocDefaultTab;
	/** Show the dashed minimap on the edge of the note. */
	showMinimap: boolean;
	/** Horizontal scale of the dashed minimap markers, as a percentage. */
	minimapWidthScale: number;
	/** Vertical scale of marker thickness and spacing, as a percentage. */
	minimapVerticalScale: number;
	/** Show the open-task badge on the edge, next to the dashed minimap. */
	showTasksInMinimap: boolean;
	/** Which edge of the note to dock the minimap / popover on. */
	side: TocSide;
	/** Open the popover on hover or only on click. */
	openTrigger: TocTrigger;
	/** Grace period, in ms, before the popover closes once the mouse leaves it. */
	closeDelay: number;
	/** Width of the TOC popover in CSS pixels. */
	popoverWidth: number;
	/** Lowest heading level to include (1 = H1). */
	minLevel: number;
	/** Highest heading level to include (6 = H6). */
	maxLevel: number;
	/** Smoothly animate the scroll when navigating to a heading. */
	smoothScroll: boolean;
	/** Temporarily preview a hovered heading, restoring the viewport on leave. */
	scrollToHeadingOnHover: boolean;
	/** Show a clickable checkbox on each task row (clicking completes the task). */
	showTaskCheckboxes: boolean;
	/** Background of the selected tab as a hex color; empty follows the theme. */
	activeTabBgColor: string;
	/** Wrap long headings/tasks over several lines instead of cutting them. */
	multiLine: boolean;

	// ---- outline model ------------------------------------------------------

	/** One nested tree, or the original separate Headings / Tasks tabs. */
	outlineMode: TocOutlineMode;
	/** Which plain bullets and numbered items to include. */
	listItems: TocListItems;
	/** Task statuses to surface. */
	taskStatuses: TaskStatusKey[];
	/** Include callout headers (`> [!note] Title`) as outline rows. */
	showCallouts: boolean;
	/** Reduce inline Markdown to plain text in outline rows. */
	stripMarkdown: boolean;
	/** Also remove `#tags` from the displayed text. */
	stripTags: boolean;
	/** Allow folding a row's children. */
	collapsible: boolean;

	// ---- platform -----------------------------------------------------------

	/** Add a button to the note header that opens the outline. */
	headerButton: TocHeaderButton;
	/** Show the outline in Obsidian's own side panel (desktop) / drawer
	 *  (mobile) as well as, or instead of, the floating overlay. */
	sidebarMode: TocSidebarMode;
	/** Which dock the sidebar view lives in. */
	sidebarSide: TocSide;
	/** Phones only: collapse the drawer after a row is tapped, so the note
	 *  that was just scrolled to is actually visible. */
	sidebarCollapseOnTap: boolean;
	/** Hide the edge minimap on phones, where it is too narrow to tap. */
	hideMinimapOnPhone: boolean;
}

export const DEFAULT_SETTINGS: SubtleTocSettings = {
	show: "both",
	defaultTab: "headings",
	showMinimap: true,
	minimapWidthScale: 100,
	minimapVerticalScale: 100,
	showTasksInMinimap: true,
	side: "right",
	openTrigger: "hover",
	closeDelay: 160,
	popoverWidth: 264,
	minLevel: 1,
	maxLevel: 6,
	smoothScroll: true,
	scrollToHeadingOnHover: false,
	showTaskCheckboxes: false,
	activeTabBgColor: "",
	multiLine: true,

	outlineMode: "unified",
	// Off by default: a meeting-notes page can carry 150+ bullets, and the
	// outline should stay an outline until the user asks for more.
	listItems: "none",
	taskStatuses: ["todo"],
	showCallouts: false,
	stripMarkdown: true,
	stripTags: false,
	collapsible: true,

	headerButton: "auto",
	hideMinimapOnPhone: true,

	// The view is registered and can be opened at any time (command, or the
	// dock's own tab); `off` only means the plugin never places it by itself.
	sidebarMode: "off",
	sidebarSide: "right",
	sidebarCollapseOnTap: true,
};
