import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEventsExecute } from "./src/tools/events";
import { makeRpcExecute } from "./src/tools/rpc";

type ClientHandler = (socket: Socket) => void;

async function withSocketServer<T>(handler: ClientHandler, run: (socketPath: string) => Promise<T>): Promise<T> {
	const directory = mkdtempSync(join(tmpdir(), "cmux-control-"));
	const socketPath = join(directory, "cmux.sock");
	const server = createServer(handler);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolve);
	});
	try {
		return await run(socketPath);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(directory, { recursive: true, force: true });
	}
}

function testEnvironment(socketPath: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		CMUX_SOCKET_PATH: socketPath,
		CMUX_SOCKET: undefined,
		CMUX_SOCKET_CAPABILITY: "test-capability",
		CMUX_SOCKET_PASSWORD: undefined,
	};
}

function readWireRequest(socket: Socket, onRequest: (request: Record<string, unknown>) => void): void {
	let input = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		input += chunk;
		const newline = input.indexOf("\n");
		if (newline < 0) return;
		const line = input.slice(0, newline);
		expect(line.startsWith("_cmux_capability_v1 test-capability ")).toBe(true);
		const json = line.slice("_cmux_capability_v1 test-capability ".length);
		onRequest(JSON.parse(json) as Record<string, unknown>);
	});
}

describe("direct cmux socket transport", () => {
	test("executes RPC over the capability-wrapped v2 protocol", async () => {
		await withSocketServer(
			(socket) => {
				readWireRequest(socket, (request) => {
					expect(request.method).toBe("system.ping");
					socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { pong: true } })}\n`);
				});
			},
			async (socketPath) => {
				const execute = makeRpcExecute({ environment: testEnvironment(socketPath) });
				const result = await execute("rpc-test", { method: "system.ping" });
				expect(result.isError).toBeUndefined();
				expect(result.content).toEqual([{ type: "text", text: '{\n  "pong": true\n}' }]);
				expect(result.details).toMatchObject({ transport: "socket", method: "system.ping" });
			},
		);
	});

	test("authenticates on the socket before sending an RPC request", async () => {
		await withSocketServer(
			(socket) => {
				let input = "";
				let authenticated = false;
				socket.setEncoding("utf8");
				socket.on("data", (chunk: string) => {
					input += chunk;
					for (;;) {
						const newline = input.indexOf("\n");
						if (newline < 0) return;
						const line = input.slice(0, newline);
						input = input.slice(newline + 1);
						const prefix = "_cmux_capability_v1 test-capability ";
						expect(line.startsWith(prefix)).toBe(true);
						const command = line.slice(prefix.length);
						if (!authenticated) {
							expect(command).toBe("auth test-password");
							authenticated = true;
							socket.write("OK\n");
							continue;
						}
						const request = JSON.parse(command) as Record<string, unknown>;
						socket.end(`${JSON.stringify({ id: request.id, ok: true, result: { pong: true } })}\n`);
					}
				});
			},
			async (socketPath) => {
				const environment = testEnvironment(socketPath);
				environment.CMUX_SOCKET_PASSWORD = "test-password";
				const execute = makeRpcExecute({ environment });
				const result = await execute("rpc-auth-test", { method: "system.ping" });
				expect(result.isError).toBeUndefined();
			},
		);
	});

	test("stops an event stream after the requested number of events", async () => {
		await withSocketServer(
			(socket) => {
				readWireRequest(socket, (request) => {
					expect(request.method).toBe("events.stream");
					const params = request.params as Record<string, unknown>;
					expect(params).toMatchObject({ names: ["surface.exited"], include_heartbeats: true });
					const frames = [
						{ type: "ack", resume: { latest_seq: 40 } },
						{ type: "event", seq: 41, name: "surface.exited" },
						{ type: "event", seq: 42, name: "surface.exited" },
					];
					socket.write(`${frames.map((frame) => JSON.stringify(frame)).join("\n")}\n`);
				});
			},
			async (socketPath) => {
				const execute = makeEventsExecute(
					{
						exec: async () => {
							throw new Error("event poll should not spawn cmux");
						},
					},
					{ environment: testEnvironment(socketPath) },
				);
				const result = await execute(
					"events-test",
					{ action: "poll", name: "surface.exited", limit: 2, timeout: 1 },
					undefined,
				);
				expect(result.isError).toBeUndefined();
				expect(result.details).toMatchObject({ transport: "socket", eventCount: 2, timedOut: false });
				expect((result.content as Array<{ text: string }>)[0].text).not.toContain("stream closed at timeout");
			},
		);
	});

	test("returns captured event frames when the bounded poll times out", async () => {
		await withSocketServer(
			(socket) => {
				readWireRequest(socket, () => {
					socket.write(`${JSON.stringify({ type: "ack", resume: { latest_seq: 40 } })}\n`);
				});
			},
			async (socketPath) => {
				const execute = makeEventsExecute(
					{ exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }) },
					{ environment: testEnvironment(socketPath) },
				);
				const result = await execute("events-timeout", { action: "poll", timeout: 1 });
				expect(result.isError).toBeUndefined();
				expect((result.content as Array<{ text: string }>)[0].text).toContain("[stream closed at timeout]");
				expect(result.details).toMatchObject({ transport: "socket", timedOut: true });
			},
		);
	});

	test("rejects unsupported event actions without opening a socket", async () => {
		const execute = makeEventsExecute({
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		});
		const result = await execute("events-invalid", { action: "unknown" });
		expect(result.isError).toBe(true);
		expect((result.content as Array<{ text: string }>)[0].text).toContain(
			"unsupported cmux_events action: unknown",
		);
	});

	test("bounds captured event output before returning it", async () => {
		await withSocketServer(
			(socket) => {
				readWireRequest(socket, () => {
					const ack = JSON.stringify({ type: "ack", resume: { latest_seq: 40 } });
					const event = JSON.stringify({ type: "event", seq: 41, payload: "x".repeat(70 * 1024) });
					socket.write(`${ack}\n${event}\n`);
				});
			},
			async (socketPath) => {
				const execute = makeEventsExecute(
					{ exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }) },
					{ environment: testEnvironment(socketPath) },
				);
				const result = await execute("events-large", { action: "poll", limit: 1, timeout: 1 });
				expect(result.isError).toBeUndefined();
				expect((result.content as Array<{ text: string }>)[0].text).toContain(
					"output truncated at 65536 characters",
				);
			},
		);
	});
});
