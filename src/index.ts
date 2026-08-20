import type { CmuxExec, ExtensionAPI } from "./types";
import { createTypeBoxAdapter } from "./schema";
import { fallbackExec } from "./host";
import { makeExecute } from "./exec";
import { buildStateArgs } from "./tools/state";
import { buildLayoutArgs } from "./tools/layout";
import { buildTerminalArgs } from "./tools/terminal";
import { buildSignalArgs } from "./tools/signal";
import { makeEventsExecute } from "./tools/events";
import { buildBrowserArgs } from "./tools/browser";
import { makeRpcExecute } from "./tools/rpc";

export { fallbackExec } from "./host";
export { executeCmux } from "./exec";
export { buildStateArgs } from "./tools/state";
export { buildLayoutArgs } from "./tools/layout";
export { buildTerminalArgs } from "./tools/terminal";
export { buildSignalArgs } from "./tools/signal";
export { buildEventsArgs } from "./tools/events";
export { buildBrowserArgs } from "./tools/browser";
export { buildRpcArgs } from "./tools/rpc";

export default function cmuxExtension(pi: ExtensionAPI): void {
	const execApi: CmuxExec = {
		exec: typeof pi.exec === "function" ? pi.exec.bind(pi) : fallbackExec,
	};
	const z = pi.zod ?? createTypeBoxAdapter();
	const target = z.string().optional().describe("Explicit cmux UUID, short ref such as workspace:2, or index");
	const commonTargets = {
		workspace: target,
		pane: target,
		surface: target,
		window: target,
	};

	// Only set the extension-level display label when running in OMP (which supports the 1-arg overload)
	if (Boolean(pi.zod) && typeof pi.setLabel === "function") {
		pi.setLabel("cmux Control");
	}
	pi.registerTool({
		name: "cmux_state",
		label: "cmux State",
		description:
			"Inspect a live cmux instance: tree, windows, workspaces, panes, surfaces, terminal text, processes, notifications, sidebar state, and workspace todos. JSON output with stable refs and UUIDs where supported. Inspect before mutating layout.",
		parameters: z.object({
			action: z
				.enum([
					"ping",
					"capabilities",
					"browser_status",
					"sidebar_validate",
					"identify",
					"tree",
					"list_windows",
					"list_workspaces",
					"list_panes",
					"list_surfaces",
					"current_workspace",
					"read_screen",
					"surface_health",
					"top",
					"find_window",
					"todo_list",
					"workspace_env",
					"sidebar_state",
					"list_notifications",
					"list_status",
					"list_log",
				])
				.describe("Read-only cmux operation"),
			...commonTargets,
			all: z.boolean().optional().describe("Include every window and workspace (tree, top)"),
			lines: z.number().int().min(1).max(500).optional().describe("Terminal lines to read"),
			scrollback: z.boolean().optional().describe("Include scrollback when reading a terminal"),
			processes: z.boolean().optional().describe("Include per-process rows (top)"),
			sort: z.enum(["cpu", "mem", "proc"]).optional().describe("Sort order (top)"),
			query: z.string().optional().describe("Search text (find_window)"),
			content: z.boolean().optional().describe("Search terminal content, not just titles (find_window)"),
			limit: z.number().int().min(1).max(500).optional().describe("Maximum entries (list_log)"),
			sidebar: z.string().optional().describe("Custom sidebar name (sidebar_validate); omit to validate all"),
		}),
		loadMode: "discoverable",
		approval: "read",
		strict: true,
		execute: makeExecute(execApi, buildStateArgs),
	});

	pi.registerTool({
		name: "cmux_layout",
		label: "cmux Layout",
		description:
			"Arrange cmux windows, workspaces, panes, and surfaces: create, split, move, reorder, resize, swap, break, join, focus, rename, run workspace/tab context-menu actions, and explicitly close resources. New resources default to no focus. Verify results with cmux_state afterward.",
		parameters: z.object({
			action: z
				.enum([
					"new_window",
					"new_workspace",
					"new_split",
					"new_pane",
					"new_surface",
					"move_surface",
					"reorder_surface",
					"split_off",
					"resize_pane",
					"swap_pane",
					"break_pane",
					"join_pane",
					"move_tab_to_new_workspace",
					"move_workspace_to_window",
					"reorder_workspace",
					"workspace_action",
					"tab_action",
					"focus_pane",
					"focus_window",
					"select_workspace",
					"rename_workspace",
					"rename_tab",
					"close_surface",
					"close_workspace",
					"close_window",
					"sidebar_open",
					"sidebar_select",
				])
				.describe("Layout operation"),
			...commonTargets,
			name: z
				.string()
				.optional()
				.describe(
					"Workspace name (new_workspace) or context-menu action name (workspace_action: pin, unpin, rename, clear-name, set-description, clear-description, move-up, move-down, move-top, close-others, close-above, close-below, mark-read, mark-unread, set-color, clear-color; tab_action: rename, clear-name, close-left, close-right, close-others, new-terminal-right, new-browser-right, reload, duplicate, pin, unpin, mark-unread)",
				),
			description: z.string().optional().describe("Workspace description"),
			cwd: z.string().optional().describe("Working directory for a new workspace"),
			command: z.string().optional().describe("Initial command for a new workspace"),
			direction: z.enum(["left", "right", "up", "down"]).optional().describe("Split or resize direction"),
			type: z
				.enum(["terminal", "browser", "simulator", "agent-session"])
				.optional()
				.describe("Pane or surface type"),
			url: z.string().optional().describe("Initial URL for a browser pane, surface, or tab action"),
			profile: z.string().optional().describe("Browser profile name or UUID"),
			provider: z.enum(["codex", "claude", "opencode"]).optional().describe("Agent-session provider"),
			renderer: z.enum(["react", "solid"]).optional().describe("Agent-session renderer"),
			placement: z
				.enum(["workspace", "dock"])
				.optional()
				.describe("Target container for new_pane and new_surface; dock targets the right-sidebar Dock"),
			sidebar: z
				.string()
				.optional()
				.describe("Custom sidebar name (sidebar_open opens it as a pane; sidebar_select previews it in the left sidebar)"),
			target_pane: target,
			before: target,
			after: target,
			index: z.number().int().min(0).max(1000).optional().describe("Zero-based destination index"),
			amount: z.number().int().min(1).max(500).optional().describe("Resize amount in cells"),
			focus: z.boolean().optional().describe("Focus the resulting resource; defaults to false"),
			title: z.string().optional().describe("Replacement workspace or tab title"),
			color: z.string().optional().describe("Workspace color name or #hex (workspace_action set-color)"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		execute: makeExecute(execApi, buildLayoutArgs),
	});

	pi.registerTool({
		name: "cmux_terminal",
		label: "cmux Terminal Input",
		description:
			"Send text or a key to one explicit cmux terminal surface, clear its scrollback, or respawn its process. Read recent screen output with cmux_state first, then verify the result afterward.",
		parameters: z.object({
			action: z.enum(["send_text", "send_key", "clear_history", "respawn"]).describe("Terminal operation"),
			workspace: target,
			surface: z.string().describe("Explicit target surface UUID or short ref"),
			window: target,
			text: z.string().optional().describe("Text to send (send_text)"),
			key: z.string().optional().describe("Key name to send (send_key), such as enter, tab, escape, or ctrl+c"),
			command: z.string().optional().describe("Replacement command (respawn)"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		execute: makeExecute(execApi, buildTerminalArgs),
	});

	pi.registerTool({
		name: "cmux_signal",
		label: "cmux Signal",
		description:
			"Publish agent progress into cmux: sidebar status pills, progress bars, log entries, notifications, per-workspace todo items, and the workspace status lane. Keep text factual and free of secrets. The workspace todo checklist and manual status lane belong to the user; manage them only when explicitly asked.",
		parameters: z.object({
			action: z
				.enum([
					"notify",
					"set_status",
					"clear_status",
					"set_progress",
					"clear_progress",
					"log",
					"clear_log",
					"todo_add",
					"todo_check",
					"todo_uncheck",
					"todo_start",
					"todo_rm",
					"todo_clear",
					"workspace_status_set",
					"sync_signal",
				])
				.describe("Signal operation"),
			workspace: target,
			surface: target,
			window: target,
			title: z.string().optional().describe("Notification title"),
			subtitle: z.string().optional().describe("Notification subtitle"),
			body: z.string().optional().describe("Notification body"),
			key: z.string().optional().describe("Status pill key"),
			value: z.number().min(0).max(1).optional().describe("Progress from 0.0 through 1.0 (set_progress)"),
			label: z.string().optional().describe("Progress label"),
			icon: z.string().optional().describe("Status pill icon name"),
			color: z.string().optional().describe("Status pill color #hex"),
			priority: z.number().int().min(0).max(1000).optional().describe("Status pill priority"),
			message: z.string().optional().describe("Log message"),
			level: z.string().optional().describe("Log level"),
			source: z.string().optional().describe("Log source name"),
			text: z.string().optional().describe("Todo item text (todo_add)"),
			state: z.enum(["pending", "in-progress", "completed"]).optional().describe("Todo state (todo_add)"),
			origin: z.enum(["user", "agent"]).optional().describe("Todo origin; defaults to agent"),
			item: z.string().optional().describe("Todo item 1-based index or id (todo_check/uncheck/start/rm)"),
			lane: z
				.enum(["todo", "working", "needs-attention", "review", "done", "auto"])
				.optional()
				.describe("Workspace status lane; auto clears the manual pin (workspace_status_set)"),
			name: z
				.string()
				.optional()
				.describe("Synchronization point to release; pairs with cmux_events wait_for (sync_signal)"),
		}),
		loadMode: "discoverable",
		approval: "write",
		strict: true,
		execute: makeExecute(execApi, buildSignalArgs),
	});

	pi.registerTool({
		name: "cmux_events",
		label: "cmux Events",
		description:
			"Poll the cmux event stream (newline-delimited JSON with monotonic seq for resume) or use named tmux-style synchronization points. poll blocks until the limit or timeout is reached; pass after with the last seen seq to resume without gaps.",
		parameters: z.object({
			action: z.enum(["poll", "wait_for"]).describe("Event operation"),
			after: z.number().int().min(0).optional().describe("Resume after this event seq (poll)"),
			limit: z.number().int().min(1).max(200).optional().describe("Stop after this many events; default 20 (poll)"),
			name: z.string().optional().describe("Event name filter (poll) or synchronization point name (wait_for)"),
			category: z.string().optional().describe("Event category filter (poll)"),
			timeout: z.number().int().min(1).max(300).optional().describe("Seconds to wait; default 30"),
		}),
		loadMode: "discoverable",
		approval: "read",
		strict: true,
		execute: makeEventsExecute(execApi),
	});

	pi.registerTool({
		name: "cmux_browser",
		label: "cmux Browser",
		description:
			"Drive a cmux-owned browser surface: navigate, snapshot the DOM, interact with elements, read page state, manage tabs, and emulate viewports. Snapshot before interacting; cmux browser profiles do not share cookies with other automation stacks. Avoid purchases, sends, deletions, or permission grants without explicit confirmation.",
		parameters: z.object({
			action: z
				.enum([
					"open",
					"navigate",
					"back",
					"forward",
					"reload",
					"get_url",
					"snapshot",
					"wait",
					"click",
					"dblclick",
					"hover",
					"focus",
					"check",
					"uncheck",
					"scroll_into_view",
					"type",
					"fill",
					"press",
					"select",
					"scroll",
					"screenshot",
					"get",
					"is",
					"find",
					"eval",
					"dialog",
					"tab_new",
					"tab_list",
					"tab_switch",
					"tab_close",
					"console_list",
					"errors_list",
					"highlight",
					"viewport",
				])
				.describe("Browser operation"),
			surface: target,
			url: z.string().optional().describe("Target URL (open, navigate, tab_new)"),
			profile: z.string().optional().describe("Browser profile name or UUID (open)"),
			focus: z.boolean().optional().describe("Focus the browser surface (open); defaults to false"),
			selector: z.string().optional().describe("CSS selector target"),
			text: z.string().optional().describe("Text to type or fill; empty fill clears the input"),
			key: z.string().optional().describe("Playwright/W3C key name such as Enter, Tab, or ArrowLeft (press)"),
			value: z.string().optional().describe("Option value (select)"),
			script: z.string().optional().describe("JavaScript to evaluate (eval)"),
			what: z
				.enum(["url", "title", "text", "html", "value", "attr", "count", "box", "styles"])
				.optional()
				.describe("Property to read (get)"),
			name: z.string().optional().describe("Attribute name (get attr)"),
			check: z.enum(["visible", "enabled", "checked"]).optional().describe("State to test (is)"),
			by: z
				.enum(["role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth"])
				.optional()
				.describe("Locator strategy (find)"),
			query: z.string().optional().describe("Locator query (find)"),
			response: z.enum(["accept", "dismiss"]).optional().describe("Dialog response (dialog)"),
			interactive: z.boolean().optional().describe("Include interactive elements in snapshot; defaults to true"),
			compact: z.boolean().optional().describe("Compact snapshot output"),
			max_depth: z.number().int().min(1).max(100).optional().describe("Snapshot depth limit"),
			url_contains: z.string().optional().describe("Wait until URL contains this text (wait)"),
			load_state: z.enum(["interactive", "complete"]).optional().describe("Wait for document load state (wait)"),
			function: z.string().optional().describe("JS predicate to wait for (wait)"),
			timeout_ms: z.number().int().min(100).max(60000).optional().describe("Wait timeout in milliseconds"),
			dx: z.number().int().min(-10000).max(10000).optional().describe("Horizontal scroll delta"),
			dy: z.number().int().min(-10000).max(10000).optional().describe("Vertical scroll delta"),
			out: z.string().optional().describe("Screenshot output path"),
			index: z.number().int().min(0).max(100).optional().describe("Tab index (tab_switch, tab_close)"),
			width: z.number().int().min(1).max(4096).optional().describe("Viewport width in CSS pixels"),
			height: z.number().int().min(1).max(4096).optional().describe("Viewport height in CSS pixels"),
			reset: z.boolean().optional().describe("Reset viewport to native sizing"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		execute: makeExecute(execApi, buildBrowserArgs, () => ({ timeoutMs: 70_000 })),
	});

	pi.registerTool({
		name: "cmux_rpc",
		label: "cmux RPC",
		description:
			"Escape hatch: call a raw cmux v2 socket method with JSON params and receive structured JSON. Prefer the typed cmux tools; use this only for surface not covered by them (list methods with cmux_state capabilities). Mutating and destructive methods take effect immediately.",
		parameters: z.object({
			method: z.string().describe("Dotted v2 method name such as workspace.list or surface.read_text"),
			params: z.string().optional().describe("JSON object of method parameters"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		execute: makeRpcExecute(),
	});
}
