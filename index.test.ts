import { describe, expect, test } from "bun:test";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import type { TSchema } from "@sinclair/typebox";
import cmuxExtension, {
	buildBrowserArgs,
	buildEventsArgs,
	buildLayoutArgs,
	buildRpcArgs,
	buildSignalArgs,
	buildStateArgs,
	buildTerminalArgs,
	executeCmux,
} from "./src/index";

describe("cmux_state", () => {
	test("returns stable refs and UUIDs when inspecting the tree", () => {
		expect(buildStateArgs({ action: "tree", all: true })).toEqual([
			"--id-format",
			"both",
			"tree",
			"--all",
		]);
	});

	test("requests JSON output for listings", () => {
		expect(buildStateArgs({ action: "list_workspaces" })).toEqual([
			"--json",
			"--id-format",
			"both",
			"workspace",
			"list",
		]);
	});

	test("exposes global browser availability", () => {
		expect(buildStateArgs({ action: "browser_status" })).toEqual(["--json", "browser-status"]);
	});

	test("requires an explicit surface and bounds screen output", () => {
		expect(() => buildStateArgs({ action: "read_screen" })).toThrow("surface is required");
		expect(() =>
			buildStateArgs({ action: "read_screen", surface: "surface:4", lines: 501 }),
		).toThrow("lines must be an integer from 1 through 500");
		expect(
			buildStateArgs({ action: "read_screen", surface: "surface:4", scrollback: true, lines: 80 }),
		).toEqual(["read-screen", "--surface", "surface:4", "--lines", "80", "--scrollback"]);
	});

	test("always masks workspace environment values", () => {
		expect(buildStateArgs({ action: "workspace_env", workspace: "workspace:2" })).toEqual([
			"--json",
			"--id-format",
			"both",
			"workspace",
			"env",
			"--mask",
			"--workspace",
			"workspace:2",
		]);
	});
});

describe("cmux_layout", () => {
	test("creates background splits without stealing focus", () => {
		expect(
			buildLayoutArgs({ action: "new_split", workspace: "workspace:2", direction: "right" }),
		).toEqual(["new-split", "right", "--workspace", "workspace:2", "--focus", "false"]);
	});

	test("rejects agent-session as a pane type", () => {
		expect(() =>
			buildLayoutArgs({ action: "new_pane", workspace: "workspace:2", type: "agent-session" }),
		).toThrow("new_pane does not support type agent-session");
	});

	test("maps resize directions onto tmux-style flags", () => {
		expect(
			buildLayoutArgs({ action: "resize_pane", pane: "pane:3", direction: "left", amount: 5 }),
		).toEqual(["resize-pane", "--pane", "pane:3", "-L", "--amount", "5"]);
	});

	test("requires exactly one reorder position", () => {
		expect(() =>
			buildLayoutArgs({ action: "reorder_surface", surface: "surface:4" }),
		).toThrow("one of before, after, index is required");
		expect(() =>
			buildLayoutArgs({ action: "reorder_surface", surface: "surface:4", before: "surface:2", index: 0 }),
		).toThrow("only one of before, after, index may be set");
	});

	test("requires explicit destructive targets", () => {
		expect(() => buildLayoutArgs({ action: "close_workspace" })).toThrow("workspace is required");
		expect(buildLayoutArgs({ action: "close_workspace", workspace: "workspace:2" })).toEqual([
			"close-workspace",
			"--workspace",
			"workspace:2",
		]);
	});

	test("places panes into the right-sidebar dock", () => {
		expect(
			buildLayoutArgs({ action: "new_pane", workspace: "workspace:2", placement: "dock" }),
		).toEqual([
			"new-pane",
			"--workspace",
			"workspace:2",
			"--type",
			"terminal",
			"--placement",
			"dock",
			"--focus",
			"false",
		]);
		expect(() =>
			buildLayoutArgs({ action: "new_pane", workspace: "workspace:2", placement: "sidebar" }),
		).toThrow("placement must be workspace or dock");
	});

	test("opens and validates custom sidebars by name", () => {
		expect(buildLayoutArgs({ action: "sidebar_open", sidebar: "agents" })).toEqual([
			"sidebar",
			"open",
			"agents",
		]);
		expect(buildStateArgs({ action: "sidebar_validate" })).toEqual(["sidebar", "validate"]);
		expect(buildStateArgs({ action: "sidebar_validate", sidebar: "agents" })).toEqual([
			"sidebar",
			"validate",
			"agents",
		]);
	});
});

describe("cmux_terminal", () => {
	test("passes terminal text as one argv value", () => {
		const text = "printf '%s\\n' hello && exit";
		expect(buildTerminalArgs({ action: "send_text", surface: "surface:4", text })).toEqual([
			"send",
			"--surface",
			"surface:4",
			text,
		]);
	});

	test("respawns with an explicit replacement command", () => {
		expect(
			buildTerminalArgs({ action: "respawn", surface: "surface:4", command: "bun run dev" }),
		).toEqual(["respawn-pane", "--surface", "surface:4", "--command", "bun run dev"]);
	});
});

describe("cmux_signal", () => {
	test("requires a notification title", () => {
		expect(() => buildSignalArgs({ action: "notify" })).toThrow("title is required");
	});

	test("bounds progress to the unit interval", () => {
		expect(() => buildSignalArgs({ action: "set_progress", value: 1.5 })).toThrow(
			"value must be a number from 0 through 1",
		);
		expect(buildSignalArgs({ action: "set_progress", value: 0.5, label: "tests" })).toEqual([
			"set-progress",
			"0.5",
			"--label",
			"tests",
		]);
	});

	test("marks agent-created todos with agent origin by default", () => {
		expect(buildSignalArgs({ action: "todo_add", text: "run lint" })).toEqual([
			"todo",
			"add",
			"run lint",
			"--origin",
			"agent",
		]);
	});

	test("releases named synchronization points", () => {
		expect(buildSignalArgs({ action: "sync_signal", name: "build-done" })).toEqual([
			"wait-for",
			"-S",
			"build-done",
		]);
	});
});

describe("cmux_events", () => {
	test("polls with resume sequence, limit, and filters", () => {
		expect(
			buildEventsArgs({ action: "poll", after: 10032, limit: 5, names: ["surface.selected"], categories: ["agent"] }),
		).toEqual([
			"events",
			"--no-heartbeat",
			"--after",
			"10032",
			"--limit",
			"5",
			"--name",
			"surface.selected",
			"--category",
			"agent",
		]);
	});

	test("waits on synchronization points but cannot release them", () => {
		expect(buildEventsArgs({ action: "wait_for", name: "build-done", timeout: 60 })).toEqual([
			"wait-for",
			"build-done",
			"--timeout",
			"60",
		]);
		expect(() => buildEventsArgs({ action: "signal", name: "build-done" })).toThrow(
			"unsupported cmux_events action",
		);
	});
});

describe("cmux_browser", () => {
	test("scopes commands to an explicit surface", () => {
		expect(buildBrowserArgs({ action: "navigate", surface: "surface:9", url: "https://example.com" })).toEqual([
			"browser",
			"--surface",
			"surface:9",
			"navigate",
			"https://example.com",
		]);
	});

	test("reads attributes with selector and name", () => {
		expect(
			buildBrowserArgs({ action: "get", what: "attr", selector: "a.main", name: "href" }),
		).toEqual(["browser", "get", "attr", "a.main", "href"]);
		expect(buildBrowserArgs({ action: "get", what: "title" })).toEqual(["browser", "get", "title"]);
	});

	test("wait requires at least one condition", () => {
		expect(() => buildBrowserArgs({ action: "wait" })).toThrow(
			"one of selector, text, url_contains, load_state, function is required",
		);
	});
});

describe("cmux_rpc", () => {
	test("accepts dotted methods with JSON params", () => {
		expect(buildRpcArgs({ method: "workspace.list", params: "{}" })).toEqual([
			"rpc",
			"workspace.list",
			"{}",
		]);
	});

	test("rejects malformed methods and params", () => {
		expect(() => buildRpcArgs({ method: "workspace list" })).toThrow("dotted lowercase");
		expect(() => buildRpcArgs({ method: "workspace.list", params: "{bad" })).toThrow(
			"params must be a valid JSON document",
		);
		expect(() => buildRpcArgs({ method: "workspace.list", params: "[]" })).toThrow(
			"params must be a JSON object",
		);
	});
});

describe("tool registration", () => {
	test("assigns the correct approval tier to every tool", () => {
		const registered: Array<{ name: string; approval: string }> = [];
		const node = {
			optional: () => node,
			describe: () => node,
			min: () => node,
			max: () => node,
			int: () => node,
		};
		cmuxExtension({
			zod: { string: () => node, number: () => node, boolean: () => node, enum: () => node, object: () => node },
			setLabel: () => {},
			registerTool: (definition: { name: string; approval: string }) => registered.push(definition),
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		} as never);

		expect(Object.fromEntries(registered.map((tool) => [tool.name, tool.approval]))).toEqual({
			cmux_state: "read",
			cmux_agents: "read",
			cmux_events: "read",
			cmux_signal: "write",
			cmux_layout: "exec",
			cmux_terminal: "exec",
			cmux_browser: "exec",
			cmux_rpc: "exec",
		});
	});
});

describe("execution results", () => {
	test("marks non-zero cmux exits as tool errors", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: "", stderr: "socket unavailable\n", code: 1, killed: false }),
			},
			"ping",
			["ping"],
		);

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "cmux ping failed with exit code 1:\nsocket unavailable" },
		]);
	});

	test("prefers stdout and drops alias notices on stderr", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({
					stdout: "OK workspace:81\n",
					stderr: "cmux: 'list-workspaces' is now an alias\n",
					code: 0,
					killed: false,
				}),
			},
			"new_workspace",
			["new-workspace"],
		);

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: "OK workspace:81" }]);
	});

	test("treats a timed-out event poll with output as a bounded read", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: '{"type":"ack"}\n', stderr: "", code: 143, killed: true }),
			},
			"poll",
			["events"],
			{ acceptTimeout: true },
		);

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([
			{ type: "text", text: '{"type":"ack"}\n[stream closed at timeout]' },
		]);
	});

	test("hints at version skew on unknown commands", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: "", stderr: "cmux: unknown command 'workspace'\n", code: 1, killed: false }),
			},
			"list_workspaces",
			["workspace", "list"],
		);

		expect(result.isError).toBe(true);
		expect((result.content as Array<{ text: string }>)[0].text).toContain(
			"may be older than this extension",
		);
	});
});

describe("extension registration compatibility", () => {
	test("registers tools with valid TypeBox schemas that pass TypeCompiler on all 8 tools", () => {
		const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
		const fakePi = {
			registerTool(tool: { name: string; description: string; parameters: Record<string, unknown> }) {
				tools.push(tool);
			},
		};

		cmuxExtension(fakePi as never);
		expect(tools.length).toBe(8);
		const names = tools.map((t) => t.name);
		expect(names).toEqual([
			"cmux_state",
			"cmux_agents",
			"cmux_layout",
			"cmux_terminal",
			"cmux_signal",
			"cmux_events",
			"cmux_browser",
			"cmux_rpc",
		]);

		for (const tool of tools) {
			const compiled = TypeCompiler.Compile(tool.parameters as unknown as TSchema);
			expect(compiled).toBeDefined();
		}

		// Verify schema validation on cmux_state actions
		const stateTool = tools.find((t) => t.name === "cmux_state");
		const stateCompiler = TypeCompiler.Compile(stateTool?.parameters as unknown as TSchema);
		expect(stateCompiler.Check({ action: "ping" })).toBe(true);
		expect(stateCompiler.Check({ action: "tree", all: true })).toBe(true);
		expect(stateCompiler.Check({ action: "not_a_real_action" })).toBe(false);
	});
	test("uses pi.zod directly when provided by OMP", () => {
		let zodUsed = false;
		const makeNode = () => {
			const node = {
				optional: () => node,
				describe: () => node,
				min: () => node,
				max: () => node,
				int: () => node,
			};
			return node;
		};
		const fakeZod = {
			string: makeNode,
			number: makeNode,
			boolean: makeNode,
			enum: makeNode,
			object: () => {
				zodUsed = true;
				return makeNode();
			},
		};

		const fakePi = {
			zod: fakeZod,
			setLabel: () => {},
			registerTool: () => {},
		};

		cmuxExtension(fakePi as unknown as { registerTool: () => void });
		expect(zodUsed).toBe(true);
	});
});
