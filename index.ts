const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const JSON_PRESENTATION = ["--json", "--id-format", "both"];

type Params = Record<string, unknown>;

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

interface CmuxExec {
	exec(
		command: string,
		args: string[],
		options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
	): Promise<ExecResult>;
}

interface SchemaNode {
	optional(): SchemaNode;
	describe(text: string): SchemaNode;
	min(value: number): SchemaNode;
	max(value: number): SchemaNode;
	int(): SchemaNode;
}

interface SchemaBuilder {
	string(): SchemaNode;
	number(): SchemaNode;
	boolean(): SchemaNode;
	enum(values: readonly string[]): SchemaNode;
	object(shape: Record<string, SchemaNode>): SchemaNode;
}

interface ToolRegistration {
	name: string;
	label: string;
	description: string;
	parameters: SchemaNode;
	loadMode: "discoverable";
	approval: "read" | "write" | "exec";
	strict: boolean;
	execute(id: string, params: Params, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

interface ExtensionAPI extends CmuxExec {
	zod: SchemaBuilder;
	setLabel(label: string): void;
	registerTool(definition: ToolRegistration): void;
}

// ============================================================================
// Parameter validation
// ============================================================================

function requiredString(params: Params, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function optionalString(params: Params, key: string): string | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return value;
}

function optionalBoolean(params: Params, key: string): boolean | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
	return value;
}

function optionalInteger(params: Params, key: string, minimum: number, maximum: number): number | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`${key} must be an integer from ${minimum} through ${maximum}`);
	}
	return value as number;
}

function requiredNumber(params: Params, key: string, minimum: number, maximum: number): number {
	const value = params[key];
	if (typeof value !== "number" || Number.isNaN(value) || value < minimum || value > maximum) {
		throw new Error(`${key} must be a number from ${minimum} through ${maximum}`);
	}
	return value;
}

function pushOptional(args: string[], flag: string, value: string | number | undefined): void {
	if (value !== undefined) args.push(flag, String(value));
}

function pushTargets(args: string[], params: Params, keys: readonly string[]): void {
	for (const key of keys) pushOptional(args, `--${key}`, optionalString(params, key));
}

function pushFocus(args: string[], params: Params): void {
	args.push("--focus", String(optionalBoolean(params, "focus") ?? false));
}

function actionOf(params: Params): string {
	return requiredString(params, "action");
}

function requireOne(params: Params, keys: readonly string[]): void {
	if (!keys.some((key) => params[key] !== undefined)) {
		throw new Error(`one of ${keys.join(", ")} is required`);
	}
}

function requireAtMostOne(params: Params, keys: readonly string[]): void {
	const present = keys.filter((key) => params[key] !== undefined);
	if (present.length > 1) throw new Error(`only one of ${keys.join(", ")} may be set`);
}

// ============================================================================
// cmux_state — read-only inspection
// ============================================================================

export function buildStateArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "ping":
			return ["ping"];
		case "capabilities":
			return ["capabilities"];
		case "browser_status":
			return ["--json", "browser-status"];
		case "identify": {
			const args = ["--json", "identify", "--no-caller"];
			pushTargets(args, params, ["workspace", "surface", "window"]);
			return args;
		}
		case "tree": {
			const args = ["--id-format", "both", "tree"];
			const all = optionalBoolean(params, "all") ?? false;
			if (all) {
				if (params.workspace !== undefined || params.window !== undefined) {
					throw new Error("all cannot be combined with workspace or window");
				}
				args.push("--all");
			} else {
				pushTargets(args, params, ["workspace", "window"]);
			}
			return args;
		}
		case "list_windows":
			return [...JSON_PRESENTATION, "list-windows"];
		case "list_workspaces": {
			const args = [...JSON_PRESENTATION, "workspace", "list"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "list_panes": {
			const args = [...JSON_PRESENTATION, "list-panes"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_surfaces": {
			const args = [...JSON_PRESENTATION, "list-pane-surfaces"];
			requireOne(params, ["workspace", "pane"]);
			pushTargets(args, params, ["workspace", "pane", "window"]);
			return args;
		}
		case "current_workspace": {
			const args = [...JSON_PRESENTATION, "current-workspace"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "read_screen": {
			const args = ["read-screen", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			args.push("--lines", String(optionalInteger(params, "lines", 1, 500) ?? 100));
			if (optionalBoolean(params, "scrollback") ?? false) args.push("--scrollback");
			return args;
		}
		case "surface_health": {
			const args = ["surface-health"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "top": {
			const args = ["top"];
			if (optionalBoolean(params, "all") ?? false) args.push("--all");
			else pushTargets(args, params, ["workspace", "window"]);
			if (optionalBoolean(params, "processes") ?? false) args.push("--processes");
			pushOptional(args, "--sort", optionalString(params, "sort"));
			return args;
		}
		case "find_window": {
			const args = ["find-window"];
			if (optionalBoolean(params, "content") ?? false) args.push("--content");
			args.push(requiredString(params, "query"));
			return args;
		}
		case "todo_list": {
			const args = [...JSON_PRESENTATION, "todo", "list"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "workspace_env": {
			// Values may be secrets: masking is unconditional. Use cmux directly
			// outside the agent when full values are genuinely needed.
			const args = [...JSON_PRESENTATION, "workspace", "env", "--mask"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "sidebar_state": {
			const args = ["sidebar-state"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_notifications":
			return [...JSON_PRESENTATION, "list-notifications"];
		case "list_status": {
			const args = [...JSON_PRESENTATION, "list-status"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_log": {
			const args = [...JSON_PRESENTATION, "list-log"];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--limit", optionalInteger(params, "limit", 1, 500));
			return args;
		}
		default:
			throw new Error(`unsupported cmux_state action: ${params.action}`);
	}
}

// ============================================================================
// cmux_layout — window/workspace/pane/surface arrangement
// ============================================================================

export function buildLayoutArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "new_window":
			return ["new-window"];
		case "new_workspace": {
			const args = ["new-workspace"];
			pushOptional(args, "--name", optionalString(params, "name"));
			pushOptional(args, "--description", optionalString(params, "description"));
			pushOptional(args, "--cwd", optionalString(params, "cwd"));
			pushOptional(args, "--command", optionalString(params, "command"));
			pushTargets(args, params, ["window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_split": {
			const args = [
				"new-split",
				requiredString(params, "direction"),
				"--workspace",
				requiredString(params, "workspace"),
			];
			pushTargets(args, params, ["surface", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_pane": {
			const args = ["new-pane", "--workspace", requiredString(params, "workspace")];
			const type = optionalString(params, "type") ?? "terminal";
			if (type === "agent-session") throw new Error("new_pane does not support type agent-session; use new_surface");
			pushOptional(args, "--type", type);
			pushOptional(args, "--direction", optionalString(params, "direction"));
			pushOptional(args, "--url", optionalString(params, "url"));
			pushOptional(args, "--profile", optionalString(params, "profile"));
			pushTargets(args, params, ["window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_surface": {
			const args = ["new-surface", "--pane", requiredString(params, "pane")];
			const type = optionalString(params, "type") ?? "terminal";
			const provider = optionalString(params, "provider");
			const renderer = optionalString(params, "renderer");
			if ((provider !== undefined || renderer !== undefined) && type !== "agent-session") {
				throw new Error("provider and renderer require type agent-session");
			}
			pushOptional(args, "--type", type);
			pushOptional(args, "--url", optionalString(params, "url"));
			pushOptional(args, "--provider", provider);
			pushOptional(args, "--renderer", renderer);
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_surface": {
			const args = ["move-surface", "--surface", requiredString(params, "surface")];
			requireOne(params, ["pane", "workspace"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["pane", "workspace", "window", "before", "after"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			pushFocus(args, params);
			return args;
		}
		case "reorder_surface": {
			const args = ["reorder-surface", "--surface", requiredString(params, "surface")];
			requireOne(params, ["before", "after", "index"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["before", "after", "workspace", "window"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			return args;
		}
		case "split_off": {
			const args = [
				"split-off",
				"--surface",
				requiredString(params, "surface"),
				requiredString(params, "direction"),
			];
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "resize_pane": {
			const flag = { left: "-L", right: "-R", up: "-U", down: "-D" }[requiredString(params, "direction")];
			if (flag === undefined) throw new Error("direction must be left, right, up, or down");
			const args = ["resize-pane", "--pane", requiredString(params, "pane"), flag];
			pushOptional(args, "--amount", optionalInteger(params, "amount", 1, 500));
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "swap_pane": {
			const args = [
				"swap-pane",
				"--pane",
				requiredString(params, "pane"),
				"--target-pane",
				requiredString(params, "target_pane"),
			];
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "break_pane": {
			const args = ["break-pane"];
			requireOne(params, ["pane", "surface"]);
			pushTargets(args, params, ["pane", "surface", "workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "join_pane": {
			const args = ["join-pane", "--target-pane", requiredString(params, "target_pane")];
			requireOne(params, ["pane", "surface"]);
			pushTargets(args, params, ["pane", "surface", "workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_tab_to_new_workspace": {
			const args = ["move-tab-to-new-workspace", "--surface", requiredString(params, "surface")];
			pushOptional(args, "--title", optionalString(params, "title"));
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_workspace_to_window": {
			return [
				"move-workspace-to-window",
				"--workspace",
				requiredString(params, "workspace"),
				"--window",
				requiredString(params, "window"),
			];
		}
		case "reorder_workspace": {
			const args = ["reorder-workspace", "--workspace", requiredString(params, "workspace")];
			requireOne(params, ["before", "after", "index"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["before", "after", "window"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			return args;
		}
		case "workspace_action": {
			const args = ["workspace-action", "--action", requiredString(params, "name")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--title", optionalString(params, "title"));
			pushOptional(args, "--color", optionalString(params, "color"));
			pushOptional(args, "--description", optionalString(params, "description"));
			return args;
		}
		case "tab_action": {
			const args = ["tab-action", "--action", requiredString(params, "name")];
			pushTargets(args, params, ["surface", "workspace", "window"]);
			pushOptional(args, "--title", optionalString(params, "title"));
			pushOptional(args, "--url", optionalString(params, "url"));
			return args;
		}
		case "focus_pane": {
			const args = ["focus-pane", "--pane", requiredString(params, "pane")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "focus_window":
			return ["focus-window", "--window", requiredString(params, "window")];
		case "select_workspace": {
			const args = ["select-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "rename_workspace": {
			const args = ["rename-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			args.push(requiredString(params, "title"));
			return args;
		}
		case "rename_tab": {
			const args = ["rename-tab", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, "title"));
			return args;
		}
		case "close_surface": {
			const args = ["close-surface", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "close_workspace": {
			const args = ["close-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "close_window":
			return ["close-window", "--window", requiredString(params, "window")];
		default:
			throw new Error(`unsupported cmux_layout action: ${params.action}`);
	}
}

// ============================================================================
// cmux_terminal — input to terminal surfaces
// ============================================================================

export function buildTerminalArgs(params: Params): string[] {
	const action = actionOf(params);
	switch (action) {
		case "send_text":
		case "send_key": {
			const args = [action === "send_text" ? "send" : "send-key"];
			args.push("--surface", requiredString(params, "surface"));
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, action === "send_text" ? "text" : "key"));
			return args;
		}
		case "clear_history": {
			const args = ["clear-history", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "respawn": {
			const args = ["respawn-pane", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--command", optionalString(params, "command"));
			return args;
		}
		default:
			throw new Error(`unsupported cmux_terminal action: ${params.action}`);
	}
}

// ============================================================================
// cmux_signal — sidebar status, progress, logs, notifications, todos
// ============================================================================

export function buildSignalArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "notify": {
			const args = ["notify", "--title", requiredString(params, "title")];
			pushOptional(args, "--subtitle", optionalString(params, "subtitle"));
			pushOptional(args, "--body", optionalString(params, "body"));
			pushTargets(args, params, ["workspace", "surface", "window"]);
			return args;
		}
		case "set_status": {
			const args = ["set-status", requiredString(params, "key"), requiredString(params, "value")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--icon", optionalString(params, "icon"));
			pushOptional(args, "--color", optionalString(params, "color"));
			pushOptional(args, "--priority", optionalInteger(params, "priority", 0, 1000));
			return args;
		}
		case "clear_status": {
			const args = ["clear-status", requiredString(params, "key")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "set_progress": {
			const args = ["set-progress", String(requiredNumber(params, "value", 0, 1))];
			pushOptional(args, "--label", optionalString(params, "label"));
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "clear_progress": {
			const args = ["clear-progress"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "log": {
			const args = ["log"];
			pushOptional(args, "--level", optionalString(params, "level"));
			pushOptional(args, "--source", optionalString(params, "source"));
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, "message"));
			return args;
		}
		case "clear_log": {
			const args = ["clear-log"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "todo_add": {
			const args = ["todo", "add", requiredString(params, "text")];
			pushOptional(args, "--state", optionalString(params, "state"));
			args.push("--origin", optionalString(params, "origin") ?? "agent");
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "todo_check":
		case "todo_uncheck":
		case "todo_start":
		case "todo_rm": {
			const verb = actionOf(params).slice("todo_".length);
			const args = ["todo", verb, requiredString(params, "item")];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "todo_clear": {
			const args = ["todo", "clear"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "workspace_status_set": {
			const args = ["workspace", "status", "set", requiredString(params, "lane")];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "sync_signal":
			return ["wait-for", "-S", requiredString(params, "name")];
		default:
			throw new Error(`unsupported cmux_signal action: ${params.action}`);
	}
}

// ============================================================================
// cmux_events — event polling and named synchronization points
// ============================================================================

export function buildEventsArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "poll": {
			const args = ["events", "--no-heartbeat"];
			pushOptional(args, "--after", optionalInteger(params, "after", 0, Number.MAX_SAFE_INTEGER));
			args.push("--limit", String(optionalInteger(params, "limit", 1, 200) ?? 20));
			const names = params.names;
			if (names !== undefined) {
				if (!Array.isArray(names) || names.some((name) => typeof name !== "string" || name.length === 0)) {
					throw new Error("names must be an array of non-empty strings");
				}
				for (const name of names) args.push("--name", name);
			}
			const categories = params.categories;
			if (categories !== undefined) {
				if (!Array.isArray(categories) || categories.some((c) => typeof c !== "string" || c.length === 0)) {
					throw new Error("categories must be an array of non-empty strings");
				}
				for (const category of categories) args.push("--category", category);
			}
			return args;
		}
		case "wait_for": {
			const args = ["wait-for", requiredString(params, "name")];
			args.push("--timeout", String(optionalInteger(params, "timeout", 1, 300) ?? 30));
			return args;
		}
		default:
			throw new Error(`unsupported cmux_events action: ${params.action}`);
	}
}

// ============================================================================
// cmux_browser — cmux-owned browser surface automation
// ============================================================================

const BROWSER_SELECTOR_ACTIONS: Record<string, string> = {
	click: "click",
	dblclick: "dblclick",
	hover: "hover",
	focus: "focus",
	check: "check",
	uncheck: "uncheck",
	scroll_into_view: "scroll-into-view",
	highlight: "highlight",
};

const BROWSER_BARE_ACTIONS: Record<string, string[]> = {
	back: ["back"],
	forward: ["forward"],
	reload: ["reload"],
	get_url: ["get-url"],
	tab_list: ["tab", "list"],
	console_list: ["console", "list"],
	errors_list: ["errors", "list"],
};

export function buildBrowserArgs(params: Params): string[] {
	const args = ["browser"];
	pushOptional(args, "--surface", optionalString(params, "surface"));
	const action = actionOf(params);

	const selectorSub = BROWSER_SELECTOR_ACTIONS[action];
	if (selectorSub !== undefined) {
		args.push(selectorSub, requiredString(params, "selector"));
		return args;
	}
	const bareSub = BROWSER_BARE_ACTIONS[action];
	if (bareSub !== undefined) {
		args.push(...bareSub);
		return args;
	}

	switch (action) {
		case "open": {
			args.push("open");
			const url = optionalString(params, "url");
			if (url !== undefined) args.push(url);
			pushOptional(args, "--profile", optionalString(params, "profile"));
			pushFocus(args, params);
			return args;
		}
		case "navigate":
			args.push("navigate", requiredString(params, "url"));
			return args;
		case "snapshot": {
			args.push("snapshot");
			if (optionalBoolean(params, "interactive") ?? true) args.push("--interactive");
			if (optionalBoolean(params, "compact") ?? false) args.push("--compact");
			pushOptional(args, "--max-depth", optionalInteger(params, "max_depth", 1, 100));
			pushOptional(args, "--selector", optionalString(params, "selector"));
			return args;
		}
		case "wait": {
			args.push("wait");
			requireOne(params, ["selector", "text", "url_contains", "load_state", "function"]);
			pushOptional(args, "--selector", optionalString(params, "selector"));
			pushOptional(args, "--text", optionalString(params, "text"));
			pushOptional(args, "--url-contains", optionalString(params, "url_contains"));
			pushOptional(args, "--load-state", optionalString(params, "load_state"));
			pushOptional(args, "--function", optionalString(params, "function"));
			pushOptional(args, "--timeout-ms", optionalInteger(params, "timeout_ms", 100, 60_000));
			return args;
		}
		case "type":
			args.push("type", requiredString(params, "selector"), requiredString(params, "text"));
			return args;
		case "fill":
			// Empty text clears the input, so text is optional here.
			args.push("fill", requiredString(params, "selector"), optionalString(params, "text") ?? "");
			return args;
		case "press":
			args.push("press", requiredString(params, "key"));
			return args;
		case "select":
			args.push("select", requiredString(params, "selector"), requiredString(params, "value"));
			return args;
		case "scroll": {
			args.push("scroll");
			pushOptional(args, "--selector", optionalString(params, "selector"));
			pushOptional(args, "--dx", optionalInteger(params, "dx", -10_000, 10_000));
			pushOptional(args, "--dy", optionalInteger(params, "dy", -10_000, 10_000));
			return args;
		}
		case "screenshot": {
			args.push("screenshot", "--json");
			pushOptional(args, "--out", optionalString(params, "out"));
			return args;
		}
		case "get": {
			const what = requiredString(params, "what");
			args.push("get", what);
			if (what === "url" || what === "title") return args;
			args.push(requiredString(params, "selector"));
			if (what === "attr") args.push(requiredString(params, "name"));
			return args;
		}
		case "is":
			args.push("is", requiredString(params, "check"), requiredString(params, "selector"));
			return args;
		case "find":
			args.push("find", requiredString(params, "by"), requiredString(params, "query"));
			return args;
		case "eval":
			args.push("eval", requiredString(params, "script"));
			return args;
		case "dialog": {
			args.push("dialog", requiredString(params, "response"));
			const text = optionalString(params, "text");
			if (text !== undefined) args.push(text);
			return args;
		}
		case "tab_new": {
			args.push("tab", "new");
			const url = optionalString(params, "url");
			if (url !== undefined) args.push(url);
			return args;
		}
		case "tab_switch":
			args.push("tab", "switch", String(optionalInteger(params, "index", 0, 100) ?? 0));
			return args;
		case "tab_close": {
			args.push("tab", "close");
			const index = optionalInteger(params, "index", 0, 100);
			if (index !== undefined) args.push(String(index));
			return args;
		}
		case "viewport": {
			if (optionalBoolean(params, "reset") ?? false) {
				args.push("viewport", "reset");
				return args;
			}
			args.push(
				"viewport",
				String(optionalInteger(params, "width", 1, 4096) ?? 1280),
				String(optionalInteger(params, "height", 1, 4096) ?? 800),
			);
			return args;
		}
		default:
			throw new Error(`unsupported cmux_browser action: ${params.action}`);
	}
}

// ============================================================================
// cmux_rpc — raw v2 socket escape hatch
// ============================================================================

export function buildRpcArgs(params: Params): string[] {
	const method = requiredString(params, "method");
	if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(method)) {
		throw new Error("method must be a dotted lowercase v2 method name such as workspace.list");
	}
	const rawParams = optionalString(params, "params");
	if (rawParams === undefined) return ["rpc", method];
	try {
		JSON.parse(rawParams);
	} catch {
		throw new Error("params must be a valid JSON document");
	}
	return ["rpc", method, rawParams];
}

// ============================================================================
// Execution
// ============================================================================

interface RunOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Treat a timeout kill with captured output as a successful bounded read (event streams). */
	acceptTimeout?: boolean;
}

function clipOutput(value: string): string {
	if (value.length <= OUTPUT_LIMIT) return value;
	return `${value.slice(0, OUTPUT_LIMIT)}\n… output truncated at ${OUTPUT_LIMIT} characters`;
}

export async function executeCmux(
	pi: CmuxExec,
	action: string,
	args: string[],
	options: RunOptions = {},
): Promise<Record<string, unknown>> {
	try {
		const result = await pi.exec("cmux", args, {
			signal: options.signal,
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		});
		const stdout = result.stdout.replace(/\s+$/, "");
		const stderr = result.stderr.replace(/\s+$/, "");
		const details = { action, exitCode: result.code, killed: result.killed };
		if (result.killed && options.acceptTimeout === true && stdout.length > 0) {
			return {
				content: [{ type: "text", text: clipOutput(`${stdout}\n[stream closed at timeout]`) }],
				details,
			};
		}
		if (result.code !== 0 || result.killed) {
			let reason = stderr || stdout || "cmux returned no diagnostic output";
			if (/unknown (command|option)|unrecognized/i.test(reason)) {
				reason += "\nThe installed cmux CLI may be older than this extension; check cmux version.";
			}
			const outcome = result.killed ? "was terminated" : `failed with exit code ${result.code}`;
			return {
				content: [{ type: "text", text: clipOutput(`cmux ${action} ${outcome}:\n${reason}`) }],
				details,
				isError: true,
			};
		}
		// Prefer stdout; legacy-alias notices arrive on stderr beside real output.
		const text = stdout || stderr || `cmux ${action} completed.`;
		return { content: [{ type: "text", text: clipOutput(text) }], details };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: `cmux ${action} failed: ${reason}` }],
			details: { action },
			isError: true,
		};
	}
}

function makeExecute(
	pi: CmuxExec,
	build: (params: Params) => string[],
	runOptions?: (params: Params) => RunOptions,
): ToolRegistration["execute"] {
	return async (_id, params, signal) => {
		const action = typeof params.action === "string" ? params.action : "invalid";
		try {
			return await executeCmux(pi, action, build(params), { ...runOptions?.(params), signal });
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return { content: [{ type: "text", text: reason }], details: { action }, isError: true };
		}
	};
}

// ============================================================================
// Registration
// ============================================================================

export default function cmuxExtension(pi: ExtensionAPI): void {
	const z = pi.zod;
	const target = z.string().optional().describe("Explicit cmux UUID, short ref such as workspace:2, or index");
	const commonTargets = {
		workspace: target,
		pane: target,
		surface: target,
		window: target,
	};

	pi.setLabel("cmux Control");

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
		}),
		loadMode: "discoverable",
		approval: "read",
		strict: true,
		execute: makeExecute(pi, buildStateArgs),
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
		execute: makeExecute(pi, buildLayoutArgs),
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
		execute: makeExecute(pi, buildTerminalArgs),
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
		execute: makeExecute(pi, buildSignalArgs),
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
		execute: makeExecute(
			pi,
			(params) => {
				const shaped: Params = { ...params };
				const name = optionalString(params, "name");
				const category = optionalString(params, "category");
				if (actionOf(params) === "poll") {
					if (name !== undefined) shaped.names = [name];
					if (category !== undefined) shaped.categories = [category];
				}
				return buildEventsArgs(shaped);
			},
			(params) => {
				const timeout = optionalInteger(params, "timeout", 1, 300) ?? 30;
				return { timeoutMs: (timeout + 5) * 1000, acceptTimeout: actionOf(params) === "poll" };
			},
		),
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
		execute: makeExecute(pi, buildBrowserArgs, () => ({ timeoutMs: 70_000 })),
	});

	pi.registerTool({
		name: "cmux_rpc",
		label: "cmux RPC",
		description:
			"Escape hatch: call a raw cmux v2 socket method with JSON params and receive structured JSON. Prefer the typed cmux tools; use this only for surface not covered by them (list methods with cmux_state capabilities). Mutating and destructive methods take effect immediately.",
		parameters: z.object({
			method: z.string().describe("Dotted v2 method name such as workspace.list or surface.read_text"),
			params: z.string().optional().describe("JSON document of method parameters"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		execute: makeExecute(pi, buildRpcArgs),
	});
}
