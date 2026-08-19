import { describe, expect, test } from "bun:test";
import { buildLayoutArgs, buildStateArgs, buildTerminalArgs, executeCmux } from "./index";

describe("cmux command construction", () => {
	test("returns stable refs and UUIDs when inspecting the tree", () => {
		expect(buildStateArgs({ action: "tree", all: true })).toEqual([
			"--id-format",
			"both",
			"tree",
			"--all",
		]);
	});

	test("requires an explicit surface and bounds screen output", () => {
		expect(() => buildStateArgs({ action: "read_screen" })).toThrow("surface is required");
		expect(() =>
			buildStateArgs({ action: "read_screen", surface: "surface:4", lines: 501 }),
		).toThrow("lines must be less than or equal to 500");
		expect(
			buildStateArgs({ action: "read_screen", surface: "surface:4", scrollback: true, lines: 80 }),
		).toEqual(["read-screen", "--surface", "surface:4", "--lines", "80", "--scrollback"]);
	});

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

	test("requires explicit destructive targets", () => {
		expect(() => buildLayoutArgs({ action: "close_workspace" })).toThrow("workspace is required");
		expect(buildLayoutArgs({ action: "close_workspace", workspace: "workspace:2" })).toEqual([
			"close-workspace",
			"--workspace",
			"workspace:2",
		]);
	});

	test("passes terminal text as one argv value", () => {
		const text = "printf '%s\\n' hello && exit";
		expect(buildTerminalArgs({ action: "send_text", surface: "surface:4", text })).toEqual([
			"send",
			"--surface",
			"surface:4",
			text,
		]);
	});
});

describe("cmux execution results", () => {
	test("marks non-zero cmux exits as tool errors", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: "", stderr: "socket unavailable\n", code: 1, killed: false }),
			} as never,
			"ping",
			["ping"],
		);

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: "cmux ping failed with exit code 1:\nsocket unavailable" },
		]);
	});

	test("returns successful stdout without trailing whitespace", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: "PONG\n", stderr: "", code: 0, killed: false }),
			} as never,
			"ping",
			["ping"],
		);

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: "PONG" }]);
	});

	test("preserves successful stderr diagnostics", async () => {
		const result = await executeCmux(
			{
				exec: async () => ({ stdout: "workspace:2\n", stderr: "warning\n", code: 0, killed: false }),
			} as never,
			"list_workspaces",
			["list-workspaces"],
		);

		expect(result.content).toEqual([{ type: "text", text: "workspace:2\nwarning" }]);
	});
});
