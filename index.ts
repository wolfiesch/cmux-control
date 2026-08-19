const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

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

function optionalInteger(params: Params, key: string, minimum = 0): number | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) < minimum) {
		throw new Error(`${key} must be an integer greater than or equal to ${minimum}`);
	}
	return value as number;
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

export function buildStateArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "ping":
			return ["ping"];
		case "capabilities":
			return ["capabilities"];
		case "identify": {
			const args = ["identify", "--no-caller"];
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
		case "list_workspaces": {
			const args = ["--id-format", "both", "list-workspaces"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "list_panes": {
			const args = ["--id-format", "both", "list-panes"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_surfaces": {
			const args = ["--id-format", "both", "list-pane-surfaces"];
			requireOne(params, ["workspace", "pane"]);
			pushTargets(args, params, ["workspace", "pane", "window"]);
			return args;
		}
		case "current_workspace": {
			const args = ["--id-format", "both", "current-workspace"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "read_screen": {
			const args = ["read-screen", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			const lines = optionalInteger(params, "lines", 1) ?? 100;
			if (lines > 500) throw new Error("lines must be less than or equal to 500");
			args.push("--lines", String(lines));
			if (optionalBoolean(params, "scrollback") ?? false) args.push("--scrollback");
			return args;
		}
		case "surface_health": {
			const args = ["surface-health"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		default:
			throw new Error(`unsupported cmux_state action: ${params.action}`);
	}
}

export function buildLayoutArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "new_workspace": {
			const args = ["new-workspace"];
			pushOptional(args, "--name", optionalString(params, "name"));
			pushOptional(args, "--description", optionalString(params, "description"));
			pushOptional(args, "--cwd", optionalString(params, "cwd"));
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
			pushTargets(args, params, ["surface", "panel", "window"]);
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
			pushOptional(args, "--index", optionalInteger(params, "index"));
			pushFocus(args, params);
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
		case "focus_pane": {
			const args = ["focus-pane", "--pane", requiredString(params, "pane")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
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
		default:
			throw new Error(`unsupported cmux_layout action: ${params.action}`);
	}
}

export function buildTerminalArgs(params: Params): string[] {
	const surface = requiredString(params, "surface");
	const action = actionOf(params);
	const args = [action === "send_text" ? "send" : action === "send_key" ? "send-key" : ""];
	if (args[0] === "") throw new Error(`unsupported cmux_terminal action: ${params.action}`);
	args.push("--surface", surface);
	pushTargets(args, params, ["workspace", "window"]);
	args.push(requiredString(params, action === "send_text" ? "text" : "key"));
	return args;
}

function clipOutput(value: string): string {
	if (value.length <= OUTPUT_LIMIT) return value;
	return `${value.slice(0, OUTPUT_LIMIT)}\n… output truncated at ${OUTPUT_LIMIT} characters`;
}

export async function executeCmux(
	pi: CmuxExec,
	action: string,
	args: string[],
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	try {
		const result = await pi.exec("cmux", args, { signal, timeout: DEFAULT_TIMEOUT_MS });
		const stdout = result.stdout.replace(/\s+$/, "");
		const stderr = result.stderr.replace(/\s+$/, "");
		const details = { action, exitCode: result.code, killed: result.killed };
		if (result.code !== 0 || result.killed) {
			const reason = stderr || stdout || "cmux returned no diagnostic output";
			const outcome = result.killed ? "was terminated" : `failed with exit code ${result.code}`;
			return {
				content: [{ type: "text", text: clipOutput(`cmux ${action} ${outcome}:\n${reason}`) }],
				details,
				isError: true,
			};
		}
		const text = stdout && stderr ? `${stdout}\n${stderr}` : stdout || stderr || `cmux ${action} completed.`;
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
			"Inspect a live cmux instance, enumerate stable refs and UUIDs, or read bounded terminal output. Inspect before mutating layout.",
		parameters: z.object({
			action: z
				.enum([
					"ping",
					"capabilities",
					"identify",
					"tree",
					"list_workspaces",
					"list_panes",
					"list_surfaces",
					"current_workspace",
					"read_screen",
					"surface_health",
				])
				.describe("Read-only cmux operation"),
			...commonTargets,
			all: z.boolean().optional().describe("Include every window and workspace when action is tree"),
			lines: z.number().optional().describe("Terminal lines to read, from 1 through 500"),
			scrollback: z.boolean().optional().describe("Include scrollback when reading a terminal"),
		}),
		loadMode: "discoverable",
		approval: "read",
		strict: true,
		async execute(_id, params, signal) {
			const action = actionOf(params);
			try {
				return await executeCmux(pi, action, buildStateArgs(params), signal);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: reason }], details: { action }, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "cmux_layout",
		label: "cmux Layout",
		description:
			"Create, move, focus, rename, split, or explicitly close cmux workspaces, panes, and surfaces. New resources default to no focus.",
		parameters: z.object({
			action: z
				.enum([
					"new_workspace",
					"new_split",
					"new_pane",
					"new_surface",
					"move_surface",
					"split_off",
					"focus_pane",
					"select_workspace",
					"rename_workspace",
					"rename_tab",
					"close_surface",
					"close_workspace",
				])
				.describe("Layout operation"),
			...commonTargets,
			name: z.string().optional().describe("New workspace name"),
			description: z.string().optional().describe("New workspace description"),
			cwd: z.string().optional().describe("New workspace working directory"),
			direction: z.enum(["left", "right", "up", "down"]).optional().describe("Split direction"),
			type: z
				.enum(["terminal", "browser", "simulator", "agent-session"])
				.optional()
				.describe("Pane or surface type"),
			url: z.string().optional().describe("Initial URL for a browser pane or surface"),
			profile: z.string().optional().describe("Browser profile name or UUID"),
			provider: z.enum(["codex", "claude", "opencode"]).optional().describe("Agent-session provider"),
			renderer: z.enum(["react", "solid"]).optional().describe("Agent-session renderer"),
			panel: target,
			before: target,
			after: target,
			index: z.number().optional().describe("Zero-based destination index"),
			focus: z.boolean().optional().describe("Focus the resulting resource; defaults to false"),
			title: z.string().optional().describe("Replacement workspace or tab title"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		async execute(_id, params, signal) {
			const action = actionOf(params);
			try {
				return await executeCmux(pi, action, buildLayoutArgs(params), signal);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: reason }], details: { action }, isError: true };
			}
		},
	});

	pi.registerTool({
		name: "cmux_terminal",
		label: "cmux Terminal Input",
		description:
			"Send text or a key to one explicit cmux terminal surface. Read recent screen output first, then verify the result with cmux_state.",
		parameters: z.object({
			action: z.enum(["send_text", "send_key"]).describe("Terminal input operation"),
			workspace: target,
			surface: z.string().describe("Explicit target surface UUID or short ref"),
			window: target,
			text: z.string().optional().describe("Text to send for send_text"),
			key: z.string().optional().describe("Key name to send for send_key, such as ENTER or CTRL_C"),
		}),
		loadMode: "discoverable",
		approval: "exec",
		strict: true,
		async execute(_id, params, signal) {
			const action = actionOf(params);
			try {
				return await executeCmux(pi, action, buildTerminalArgs(params), signal);
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: reason }], details: { action }, isError: true };
			}
		},
	});
}
