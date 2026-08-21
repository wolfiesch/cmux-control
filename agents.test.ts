import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeAgentsExecute } from "./src/tools/agents";

const PEER_ID = "01a02215-7989-7000-9684-56bb70f026ce";
const SELF_ID = "01a0223c-489c-7000-b5df-36579d0b6f51";
const INACTIVE_ID = "01a0090b-b42a-7000-b7d2-f73493409c9b";
const WORKSPACE_ID = "58514272-21EE-46FF-B1CC-DEA7B90A7719";
const SELF_SURFACE_ID = "47EA15DA-AA37-4273-B4C9-104146FEC9B3";
const CLAUDE_ID = "6f1c2d34-8ab9-4e51-9f02-7c3d51ea88b4";

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureTop(extraTags: Array<Record<string, unknown>> = []) {
	return {
		active: { workspace_id: WORKSPACE_ID },
		windows: [
			{
				id: "window-id",
				ref: "window:1",
				index: 0,
				workspaces: [
					{
						id: WORKSPACE_ID,
						ref: "workspace:75",
						index: 5,
						title: "cmux extension",
						tags: [
							{ key: "omp", value: "Running" },
							{ key: `omp.${PEER_ID}`, pid: 44309, resources: { cpu_percent: 1.5, memory_bytes: 500 } },
							{ key: `omp.${SELF_ID}`, pid: 96511, resources: { cpu_percent: 8, memory_bytes: 700 } },
							...extraTags,
						],
					},
				],
			},
		],
	};
}

function fixtureSurfaces() {
	return {
		workspace_id: WORKSPACE_ID,
		surfaces: [
			{
				id: "peer-surface-id",
				ref: "surface:371",
				title: "π > Implement CI fallback chains",
				pane_id: "peer-pane-id",
				pane_ref: "pane:195",
				requested_working_directory: "/Users/test/Projects/wolfxl",
				resume_binding: { kind: "omp", checkpoint_id: PEER_ID, cwd: "/Users/test/Projects/wolfxl" },
			},
			{
				id: SELF_SURFACE_ID,
				ref: "surface:428",
				title: "π > Build peer discovery",
				pane_id: "self-pane-id",
				pane_ref: "pane:220",
				resume_binding: { kind: "omp", checkpoint_id: SELF_ID, cwd: "/Users/test/Projects/cmux-control" },
			},
			{
				id: "inactive-surface-id",
				ref: "surface:18",
				title: "~/P/gpui",
				resume_binding: { kind: "omp", checkpoint_id: INACTIVE_ID, cwd: "/Users/test/Projects/gpui" },
			},
		],
	};
}

function fixtureRequest(top = fixtureTop(), surfaces = fixtureSurfaces()) {
	return async (method: string, params: unknown): Promise<unknown> => {
		if (method === "system.top") return top;
		if (method === "surface.list") {
			expect(params).toEqual({ workspace_id: WORKSPACE_ID });
			return surfaces;
		}
		throw new Error(`unexpected method ${method}`);
	};
}

function claudeFixture() {
	const top = fixtureTop([
		{ key: "claude", value: "Running" },
		{ key: `claude.${CLAUDE_ID}`, pid: 5150, resources: { cpu_percent: 3, memory_bytes: 900 } },
	]);
	const surfaces = fixtureSurfaces();
	surfaces.surfaces.push({
		id: "claude-surface-id",
		ref: "surface:512",
		title: "✳ Refactor auth middleware",
		pane_id: "claude-pane-id",
		pane_ref: "pane:301",
		requested_working_directory: "/Users/test/Projects/api",
		resume_binding: { kind: "claude", checkpoint_id: CLAUDE_ID, cwd: "/Users/test/Projects/api" },
	});
	return fixtureRequest(top, surfaces);
}

function resultJson(result: Record<string, unknown>): Record<string, unknown> {
	const content = result.content as Array<{ text: string }>;
	return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("cmux_agents", () => {
	test("joins active OMP tags to surfaces and excludes the caller", async () => {
		const execute = makeAgentsExecute({
			request: fixtureRequest(),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
		});
		const result = await execute("call", { action: "list" });
		const json = resultJson(result);
		const sessions = json.sessions as Array<Record<string, unknown>>;

		expect(result.isError).toBeUndefined();
		expect(json.scope).toBe("caller-environment");
		expect(json.selfIdentification).toBe("caller-environment");
		expect(json.count).toBe(1);
		expect(json.totalCount).toBe(1);
		expect(json.truncated).toBe(false);
		expect(sessions[0]).toMatchObject({
			sessionId: PEER_ID,
			kind: "omp",
			agent: "Oh My Pi",
			isSelf: false,
			active: true,
			processId: 44309,
			cwd: "/Users/test/Projects/wolfxl",
			mapping: "surface-binding",
		});
		expect(sessions[0].surface).toEqual({
			id: "peer-surface-id",
			ref: "surface:371",
			title: "π > Implement CI fallback chains",
		});
		expect(JSON.stringify(json)).not.toContain(INACTIVE_ID);
	});

	test("falls back to cmux active workspace when caller identity is unavailable", async () => {
		const execute = makeAgentsExecute({ request: fixtureRequest(), environment: {} });
		const result = await execute("call", { action: "list" });
		const json = resultJson(result);
		const sessions = json.sessions as Array<Record<string, unknown>>;

		expect(json.scope).toBe("cmux-active-workspace");
		expect(json.selfIdentification).toBe("unavailable");
		expect(sessions).toHaveLength(2);
		expect(sessions.every((session) => session.isSelf === null)).toBe(true);
	});

	test("bounds global-style listings without hiding the total", async () => {
		const execute = makeAgentsExecute({ request: fixtureRequest(), environment: {} });
		const result = await execute("call", { action: "list", limit: 1 });
		const json = resultJson(result);

		expect(json.totalCount).toBe(2);
		expect(json.count).toBe(1);
		expect(json.truncated).toBe(true);
		expect(json.offset).toBe(0);
		expect(json.nextOffset).toBe(1);
	});

	test("keeps an active tag visible when its surface binding is missing", async () => {
		const orphanId = "01a02244-1111-7000-aaaa-111111111111";
		const top = fixtureTop([{ key: `omp.${orphanId}`, pid: 123, resources: {} }]);
		const execute = makeAgentsExecute({
			request: fixtureRequest(top),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
		});
		const result = await execute("call", { action: "list" });
		const json = resultJson(result);
		const sessions = json.sessions as Array<Record<string, unknown>>;

		expect(sessions.find((session) => session.sessionId === orphanId)).toMatchObject({
			mapping: "active-tag-only",
			isSelf: null,
			processId: 123,
		});
	});

	test("discovers non-OMP agent sessions from the shared tag namespace", async () => {
		const execute = makeAgentsExecute({
			request: claudeFixture(),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
		});
		const result = await execute("call", { action: "list" });
		const json = resultJson(result);
		const sessions = json.sessions as Array<Record<string, unknown>>;

		expect(result.isError).toBeUndefined();
		expect(sessions.map((session) => session.kind).sort()).toEqual(["claude", "omp"]);
		const claude = sessions.find((session) => session.kind === "claude");
		expect(claude).toMatchObject({
			agent: "Claude Code",
			sessionId: CLAUDE_ID,
			isSelf: false,
			processId: 5150,
			cwd: "/Users/test/Projects/api",
			mapping: "surface-binding",
		});
		expect((claude?.workspace as Record<string, unknown>).state).toBe("Running");
	});

	test("refuses to guess a transcript format it cannot parse", async () => {
		const execute = makeAgentsExecute({
			request: claudeFixture(),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
		});
		const result = await execute("call", { action: "digest", session: CLAUDE_ID });
		const text = (result.content as Array<{ text: string }>)[0].text;

		expect(result.isError).toBe(true);
		expect(text).toContain("cannot read Claude Code transcripts");
		expect(text).toContain("read_screen");
		expect(text).toContain("surface:512");
	});

	test("gives actionable guidance when an unsupported session has no mapped surface", async () => {
		const orphanId = "8b7a6c55-1d2e-4f30-91ab-2c4d6e8f0a12";
		const top = fixtureTop([
			{ key: "codex", value: "Running" },
			{ key: `codex.${orphanId}`, pid: 4242, resources: {} },
		]);
		const execute = makeAgentsExecute({
			request: fixtureRequest(top),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
		});
		const result = await execute("call", { action: "digest", session: orphanId });
		const text = (result.content as Array<{ text: string }>)[0].text;

		expect(result.isError).toBe(true);
		expect(text).toContain("cannot read Codex transcripts");
		expect(text).toContain("no mapped cmux surface");
		expect(text).toContain("process 4242");
		expect(text).toContain("workspace:75");
		expect(text).not.toContain("read_screen");
	});

	test("returns a bounded conversational digest for an active peer", async () => {
		const root = mkdtempSync(join(tmpdir(), "cmux-control-agents-"));
		temporaryDirectories.push(root);
		const projectSessions = join(root, "-Projects-wolfxl");
		mkdirSync(projectSessions);
		const transcript = join(projectSessions, `2026-08-21T00-00-00-000Z_${PEER_ID}.jsonl`);
		writeFileSync(
			transcript,
			[
				JSON.stringify({ type: "title", title: "peer" }),
				JSON.stringify({ type: "message", timestamp: "2026-08-21T00:00:01Z", message: { role: "user", content: [{ type: "text", text: "First request" }] } }),
				JSON.stringify({ type: "message", timestamp: "2026-08-21T00:00:02Z", message: { role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "First answer" }] } }),
				JSON.stringify({ type: "message", timestamp: "2026-08-21T00:00:03Z", message: { role: "user", content: [{ type: "text", text: "Second request" }] } }),
				JSON.stringify({ type: "message", timestamp: "2026-08-21T00:00:04Z", message: { role: "assistant", content: [{ type: "toolCall", name: "bash" }, { type: "text", text: "Second answer" }] } }),
			].join("\n"),
		);
		const execute = makeAgentsExecute({
			request: fixtureRequest(),
			environment: { CMUX_WORKSPACE_ID: WORKSPACE_ID, CMUX_SURFACE_ID: SELF_SURFACE_ID },
			sessionRoots: [root],
		});
		const result = await execute("call", { action: "digest", session: PEER_ID.slice(0, 8), messages: 2 });
		const json = resultJson(result);
		const messages = json.messages as Array<Record<string, unknown>>;

		expect(result.isError).toBeUndefined();
		expect(json.requestedMessages).toBe(2);
		expect(messages.map((message) => message.text)).toEqual(["Second request", "Second answer"]);
		expect(JSON.stringify(messages)).not.toContain("private reasoning");
		expect(JSON.stringify(messages)).not.toContain("toolCall");
	});

	test("rejects overlapping scope selectors", async () => {
		const execute = makeAgentsExecute({ request: fixtureRequest(), environment: {} });
		const result = await execute("call", { action: "list", workspace: "workspace:75", all: true });
		expect(result.isError).toBe(true);
		expect((result.content as Array<{ text: string }>)[0].text).toContain("only one of workspace, window, all");
	});
});
