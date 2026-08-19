import { randomUUID } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";

const DEFAULT_SOCKET_TIMEOUT_MS = 10_000;
const CAPABILITY_PREFIX = "_cmux_capability_v1";
const MAX_SOCKET_FRAME_CHARS = 4 * 1024 * 1024;

export interface SocketRequestOptions {
	environment?: NodeJS.ProcessEnv;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export class SocketTimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SocketTimeoutError";
	}
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

function isOwnedSocket(path: string): boolean {
	try {
		const stats = statSync(path);
		if (!stats.isSocket()) return false;
		const uid = process.getuid?.();
		return uid === undefined || stats.uid === uid;
	} catch {
		return false;
	}
}

export function resolveSocketPath(environment: NodeJS.ProcessEnv = process.env): string {
	const canonical = nonEmpty(environment.CMUX_SOCKET_PATH);
	const legacy = nonEmpty(environment.CMUX_SOCKET);
	if (canonical && legacy && canonical !== legacy) {
		throw new Error("CMUX_SOCKET_PATH and CMUX_SOCKET differ; unset one before connecting");
	}
	if (canonical || legacy) return expandHome((canonical ?? legacy) as string);

	const stateDirectory = join(homedir(), ".local", "state", "cmux");
	const candidates: string[] = [];
	try {
		const marker = nonEmpty(readFileSync(join(stateDirectory, "last-socket-path"), "utf8"));
		if (marker) candidates.push(expandHome(marker));
	} catch {
		// The stable path below remains the useful diagnostic when no marker exists.
	}
	candidates.push(join(stateDirectory, "cmux.sock"));
	const uid = process.getuid?.();
	if (uid !== undefined) candidates.push(join(stateDirectory, `cmux-${uid}.sock`));
	return candidates.find(isOwnedSocket) ?? candidates[0];
}

function validateSocket(path: string): void {
	let stats;
	try {
		stats = statSync(path);
	} catch {
		throw new Error(`socket not found at ${path}`);
	}
	if (!stats.isSocket()) throw new Error(`path exists at ${path} but is not a Unix socket`);
	const uid = process.getuid?.();
	if (uid !== undefined && stats.uid !== uid) {
		throw new Error(`socket at ${path} is not owned by the current user`);
	}
}

function capabilityFrom(environment: NodeJS.ProcessEnv): string | undefined {
	const capability = nonEmpty(environment.CMUX_SOCKET_CAPABILITY);
	return capability && !/\s/.test(capability) ? capability : undefined;
}

class LineSocket {
	private readonly socket: Socket;
	private readonly capability: string | undefined;
	private buffer = "";
	private lines: string[] = [];
	private terminalError: Error | undefined;
	private waiter:
		| {
			resolve: (line: string) => void;
			reject: (error: Error) => void;
			cleanup: () => void;
		}
		| undefined;

	private constructor(socket: Socket, capability: string | undefined) {
		this.socket = socket;
		this.capability = capability;
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => this.accept(chunk));
		socket.on("error", (error) => this.terminate(error));
		socket.on("close", () => this.terminate(new Error("socket closed before reply")));
	}

	static async open(options: SocketRequestOptions = {}): Promise<LineSocket> {
		const environment = options.environment ?? process.env;
		const path = resolveSocketPath(environment);
		validateSocket(path);
		const socket = createConnection({ path });
		const connection = new LineSocket(socket, capabilityFrom(environment));
		const timeoutMs = options.timeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
		const deadline = Date.now() + timeoutMs;
		try {
			await connection.waitForConnect(timeoutMs, options.signal);
			const password = nonEmpty(environment.CMUX_SOCKET_PASSWORD);
			if (password) {
				connection.writeCommand(`auth ${password}`);
				const remaining = deadline - Date.now();
				if (remaining <= 0) throw new SocketTimeoutError("timed out authenticating with cmux socket");
				const response = await connection.readLine(remaining, options.signal);
				if (response.startsWith("ERROR:") && !response.includes("Unknown command 'auth'")) {
					throw new Error(response);
				}
			}
			return connection;
		} catch (error) {
			connection.close();
			throw error;
		}
	}

	writeCommand(command: string): void {
		const wire = this.capability ? `${CAPABILITY_PREFIX} ${this.capability} ${command}` : command;
		this.socket.write(`${wire}\n`);
	}

	readLine(timeoutMs: number, signal?: AbortSignal): Promise<string> {
		const queued = this.lines.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		if (this.terminalError) return Promise.reject(this.terminalError);
		if (this.waiter) return Promise.reject(new Error("concurrent socket reads are unsupported"));

		return new Promise<string>((resolve, reject) => {
			let timer: NodeJS.Timeout | undefined;
			const onAbort = () => finishReject(signal?.reason instanceof Error ? signal.reason : new Error("operation aborted"));
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				if (this.waiter?.cleanup === cleanup) this.waiter = undefined;
			};
			const finishResolve = (line: string) => {
				cleanup();
				resolve(line);
			};
			const finishReject = (error: Error) => {
				cleanup();
				reject(error);
			};
			this.waiter = { resolve: finishResolve, reject: finishReject, cleanup };
			timer = setTimeout(() => finishReject(new SocketTimeoutError("timed out waiting for cmux socket response")), timeoutMs);
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	close(): void {
		this.socket.destroy();
	}

	private waitForConnect(timeoutMs: number, signal?: AbortSignal): Promise<void> {
		if (this.socket.readyState === "open") return Promise.resolve();
		return new Promise<void>((resolve, reject) => {
			let timer: NodeJS.Timeout | undefined;
			const onConnect = () => finish();
			const onError = (error: Error) => finish(error);
			const onAbort = () => finish(signal?.reason instanceof Error ? signal.reason : new Error("operation aborted"));
			const cleanup = () => {
				clearTimeout(timer);
				this.socket.off("connect", onConnect);
				this.socket.off("error", onError);
				signal?.removeEventListener("abort", onAbort);
			};
			const finish = (error?: Error) => {
				cleanup();
				if (error) reject(error);
				else resolve();
			};
			this.socket.once("connect", onConnect);
			this.socket.once("error", onError);
			timer = setTimeout(() => finish(new SocketTimeoutError("timed out connecting to cmux socket")), timeoutMs);
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private accept(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) {
				if (this.buffer.length > MAX_SOCKET_FRAME_CHARS) {
					this.buffer = "";
					this.terminate(new Error(`cmux socket frame exceeded ${MAX_SOCKET_FRAME_CHARS} characters`));
					this.socket.destroy();
				}
				return;
			}
			if (newline > MAX_SOCKET_FRAME_CHARS) {
				this.buffer = "";
				this.terminate(new Error(`cmux socket frame exceeded ${MAX_SOCKET_FRAME_CHARS} characters`));
				this.socket.destroy();
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			if (this.waiter) {
				const waiter = this.waiter;
				waiter.resolve(line);
			} else {
				this.lines.push(line);
			}
		}
	}

	private terminate(error: Error): void {
		if (this.terminalError) return;
		this.terminalError = error;
		if (this.waiter) this.waiter.reject(error);
	}
}

interface V2Envelope {
	id?: unknown;
	ok?: unknown;
	result?: unknown;
	error?: { code?: unknown; message?: unknown; action?: unknown; reason?: unknown };
}

function parseEnvelope(line: string, requestId: string): V2Envelope {
	if (line.startsWith("ERROR:")) throw new Error(line);
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new Error(`invalid JSON response from cmux: ${line}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid v2 response from cmux");
	}
	const envelope = value as V2Envelope;
	if (envelope.id !== undefined && envelope.id !== requestId) {
		throw new Error("cmux response id did not match the request");
	}
	return envelope;
}

function v2Error(envelope: V2Envelope): Error {
	const code = typeof envelope.error?.code === "string" ? envelope.error.code : "error";
	const message = typeof envelope.error?.message === "string" ? envelope.error.message : "unknown v2 error";
	const sections = [`${code}: ${message}`];
	if (typeof envelope.error?.reason === "string" && envelope.error.reason.trim()) {
		sections.push(`Reason:\n  ${envelope.error.reason.trim().replaceAll("\n", "\n  ")}`);
	}
	if (typeof envelope.error?.action === "string" && envelope.error.action.trim()) {
		sections.push(`What to do:\n  ${envelope.error.action.trim().replaceAll("\n", "\n  ")}`);
	}
	return new Error(sections.join("\n\n"));
}

export async function requestV2(
	method: string,
	params: unknown,
	options: SocketRequestOptions = {},
): Promise<unknown> {
	const requestId = randomUUID();
	const connection = await LineSocket.open(options);
	try {
		connection.writeCommand(JSON.stringify({ id: requestId, method, params }));
		const line = await connection.readLine(options.timeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS, options.signal);
		const envelope = parseEnvelope(line, requestId);
		if (envelope.ok === true) return envelope.result ?? {};
		throw v2Error(envelope);
	} finally {
		connection.close();
	}
}

export async function streamV2(
	method: string,
	params: unknown,
	onLine: (line: string) => boolean | void,
	options: SocketRequestOptions = {},
): Promise<{ timedOut: boolean }> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_SOCKET_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;
	const requestId = randomUUID();
	const connection = await LineSocket.open(options);
	try {
		connection.writeCommand(JSON.stringify({ id: requestId, method, params }));
		for (;;) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) return { timedOut: true };
			let line: string;
			try {
				line = await connection.readLine(remaining, options.signal);
			} catch (error) {
				if (error instanceof SocketTimeoutError) return { timedOut: true };
				throw error;
			}
			if (onLine(line) === false) return { timedOut: false };
		}
	} finally {
		connection.close();
	}
}
