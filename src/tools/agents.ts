import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { clipOutput } from "../exec";
import { requestV2, type SocketRequestOptions } from "../transport";
import type { Params, ToolRegistration } from "../types";
import { actionOf, optionalBoolean, optionalInteger, optionalString } from "../validation";

const OMP_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_TRANSCRIPT_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_DIGEST_MESSAGE_CHARS = 2_000;

type JsonObject = Record<string, unknown>;
type V2Request = (method: string, params: unknown, options?: SocketRequestOptions) => Promise<unknown>;

interface AgentToolOptions extends SocketRequestOptions {
	request?: V2Request;
	sessionRoots?: string[];
}

interface WorkspaceSelection {
	workspaces: JsonObject[];
	source: "all" | "window" | "workspace" | "caller-environment" | "cmux-active-workspace";
}

interface InternalSession {
	kind: "omp";
	sessionId: string;
	active: true;
	isSelf: boolean | null;
	processId: number | null;
	cpuPercent: number | null;
	memoryBytes: number | null;
	workspace: { id: string; ref: string; title: string | null; state: string | null };
	pane: { id: string | null; ref: string | null };
	surface: { id: string | null; ref: string | null; title: string | null };
	cwd: string | null;
	mapping: "surface-binding" | "active-tag-only";
	agentDirectory?: string;
}

interface TranscriptMessage {
	timestamp: string | null;
	role: "user" | "assistant";
	text: string;
	truncated: boolean;
}

function object(value: unknown): JsonObject | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : undefined;
}

function objects(value: unknown): JsonObject[] {
	return Array.isArray(value) ? value.map(object).filter((item): item is JsonObject => item !== undefined) : [];
}

function string(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function boundedString(value: unknown, maximum: number): string | null {
	const result = string(value);
	if (result === null || result.length <= maximum) return result;
	return `${result.slice(0, maximum)}…`;
}

function number(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function matchesTarget(item: JsonObject, target: string): boolean {
	if (string(item.id) === target || string(item.ref) === target) return true;
	return /^\d+$/.test(target) && number(item.index) === Number(target);
}

function selectOne(items: JsonObject[], target: string, kind: string): JsonObject {
	const matches = items.filter((item) => matchesTarget(item, target));
	if (matches.length === 0) throw new Error(`${kind} ${target} was not found`);
	if (matches.length > 1) throw new Error(`${kind} ${target} is ambiguous; use its UUID or ref`);
	return matches[0];
}

function selectWorkspaces(top: JsonObject, params: Params, environment: NodeJS.ProcessEnv): WorkspaceSelection {
	const workspaceTarget = optionalString(params, "workspace");
	const windowTarget = optionalString(params, "window");
	const all = optionalBoolean(params, "all") ?? false;
	const selectors = Number(workspaceTarget !== undefined) + Number(windowTarget !== undefined) + Number(all);
	if (selectors > 1) throw new Error("only one of workspace, window, all may be set");

	const windows = objects(top.windows);
	if (all) {
		return { workspaces: windows.flatMap((window) => objects(window.workspaces)), source: "all" };
	}
	if (windowTarget !== undefined) {
		return { workspaces: objects(selectOne(windows, windowTarget, "window").workspaces), source: "window" };
	}
	if (workspaceTarget !== undefined) {
		const matches = windows.flatMap((window) => objects(window.workspaces)).filter((workspace) =>
			matchesTarget(workspace, workspaceTarget),
		);
		if (matches.length === 0) throw new Error(`workspace ${workspaceTarget} was not found`);
		if (matches.length > 1) throw new Error(`workspace ${workspaceTarget} is ambiguous; use its UUID or ref`);
		return { workspaces: matches, source: "workspace" };
	}

	const everyWorkspace = windows.flatMap((window) => objects(window.workspaces));
	const callerWorkspaceId = environment.CMUX_WORKSPACE_ID?.trim();
	if (callerWorkspaceId) {
		const match = everyWorkspace.find((workspace) => string(workspace.id) === callerWorkspaceId);
		if (match) return { workspaces: [match], source: "caller-environment" };
	}
	const activeWorkspaceId = string(object(top.active)?.workspace_id);
	if (activeWorkspaceId) {
		const match = everyWorkspace.find((workspace) => string(workspace.id) === activeWorkspaceId);
		if (match) return { workspaces: [match], source: "cmux-active-workspace" };
	}
	throw new Error("current workspace is unavailable; pass workspace, window, or all explicitly");
}

function activeTags(workspace: JsonObject): Map<string, JsonObject> {
	const tags = new Map<string, JsonObject>();
	for (const tag of objects(workspace.tags)) {
		const key = string(tag.key);
		if (!key?.startsWith("omp.")) continue;
		const sessionId = key.slice(4);
		if (OMP_SESSION_ID.test(sessionId) && number(tag.pid) !== null) tags.set(sessionId, tag);
	}
	return tags;
}

function workspaceState(workspace: JsonObject): string | null {
	const aggregate = objects(workspace.tags).find((tag) => string(tag.key) === "omp");
	return string(aggregate?.value);
}

function piAgentDirectory(binding: JsonObject): string | undefined {
	const environments = [object(binding.environment), object(object(binding.launch_command)?.environment)];
	for (const environment of environments) {
		const directory = string(environment?.PI_CODING_AGENT_DIR);
		if (directory?.startsWith("/")) return directory;
	}
	return undefined;
}

function publicSession(session: InternalSession): Omit<InternalSession, "agentDirectory"> {
	const { agentDirectory: _, ...result } = session;
	return result;
}

function sessionFromSurface(
	workspace: JsonObject,
	surface: JsonObject,
	tag: JsonObject,
	selfSurfaceId: string | undefined,
): InternalSession | undefined {
	const binding = object(surface.resume_binding);
	if (!binding || string(binding.kind) !== "omp") return undefined;
	const sessionId = string(binding.checkpoint_id);
	if (!sessionId || !OMP_SESSION_ID.test(sessionId)) return undefined;
	const resources = object(tag.resources);
	const surfaceId = string(surface.id);
	return {
		kind: "omp",
		sessionId,
		active: true,
		isSelf: selfSurfaceId ? surfaceId === selfSurfaceId : null,
		processId: number(tag.pid),
		cpuPercent: number(resources?.cpu_percent),
		memoryBytes: number(resources?.memory_bytes),
		workspace: {
			id: string(workspace.id) ?? "",
			ref: string(workspace.ref) ?? "",
			title: boundedString(workspace.title, 256),
			state: workspaceState(workspace),
		},
		pane: { id: string(surface.pane_id), ref: string(surface.pane_ref) },
		surface: { id: surfaceId, ref: string(surface.ref), title: boundedString(surface.title, 512) },
		cwd:
			boundedString(binding.cwd, 512) ??
			boundedString(object(binding.launch_command)?.working_directory, 512) ??
			boundedString(surface.requested_working_directory, 512),
		mapping: "surface-binding",
		agentDirectory: piAgentDirectory(binding),
	};
}

function orphanSession(workspace: JsonObject, sessionId: string, tag: JsonObject): InternalSession {
	const resources = object(tag.resources);
	return {
		kind: "omp",
		sessionId,
		active: true,
		isSelf: null,
		processId: number(tag.pid),
		cpuPercent: number(resources?.cpu_percent),
		memoryBytes: number(resources?.memory_bytes),
		workspace: {
			id: string(workspace.id) ?? "",
			ref: string(workspace.ref) ?? "",
			title: boundedString(workspace.title, 256),
			state: workspaceState(workspace),
		},
		pane: { id: null, ref: null },
		surface: { id: null, ref: null, title: null },
		cwd: null,
		mapping: "active-tag-only",
	};
}

async function discoverSessions(
	params: Params,
	request: V2Request,
	options: SocketRequestOptions,
	environment: NodeJS.ProcessEnv,
): Promise<{ sessions: InternalSession[]; selection: WorkspaceSelection }> {
	const topValue = await request("system.top", { all: true, processes: false }, options);
	const top = object(topValue);
	if (!top) throw new Error("cmux system.top returned an invalid response");
	const selection = selectWorkspaces(top, params, environment);
	const selfSurfaceId = environment.CMUX_SURFACE_ID?.trim();
	const surfaceValues = await Promise.all(
		selection.workspaces.map((workspace) => request("surface.list", { workspace_id: string(workspace.id) }, options)),
	);
	const sessions: InternalSession[] = [];
	for (let index = 0; index < selection.workspaces.length; index += 1) {
		const workspace = selection.workspaces[index];
		const tags = activeTags(workspace);
		const surfaceList = object(surfaceValues[index]);
		if (!surfaceList) throw new Error(`cmux surface.list returned an invalid response for ${string(workspace.ref) ?? "workspace"}`);
		for (const surface of objects(surfaceList.surfaces)) {
			const sessionId = string(object(surface.resume_binding)?.checkpoint_id);
			if (!sessionId) continue;
			const tag = tags.get(sessionId);
			if (!tag) continue;
			const session = sessionFromSurface(workspace, surface, tag, selfSurfaceId);
			if (session) {
				sessions.push(session);
				tags.delete(sessionId);
			}
		}
		for (const [sessionId, tag] of tags) sessions.push(orphanSession(workspace, sessionId, tag));
	}
	return { sessions, selection };
}

function standardSessionRoots(agentDirectory: string | undefined): string[] {
	const roots: string[] = [];
	if (agentDirectory) roots.push(join(agentDirectory, "sessions"));
	roots.push(join(homedir(), ".omp", "agent", "sessions"));
	const profiles = join(homedir(), ".omp", "profiles");
	try {
		for (const entry of readdirSync(profiles, { withFileTypes: true })) {
			if (entry.isDirectory()) roots.push(join(profiles, entry.name, "agent", "sessions"));
		}
	} catch {
		// A Pi-only installation may not have OMP profile roots.
	}
	return roots;
}

function directoryExists(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function findTranscript(session: InternalSession, configuredRoots?: string[]): { path: string; duplicateCount: number } {
	const suffix = `_${session.sessionId}.jsonl`;
	const roots = configuredRoots ?? standardSessionRoots(session.agentDirectory);
	const candidates = new Map<string, { path: string; modified: number }>();
	for (const root of roots) {
		if (!directoryExists(root)) continue;
		for (const directory of readdirSync(root, { withFileTypes: true })) {
			const directoryPath = join(root, directory.name);
			if (!directory.isDirectory() && !directoryExists(directoryPath)) continue;
			for (const file of readdirSync(directoryPath, { withFileTypes: true })) {
				if (!file.isFile() || !file.name.endsWith(suffix)) continue;
				const path = join(directoryPath, file.name);
				try {
					const realPath = realpathSync(path);
					candidates.set(realPath, { path, modified: statSync(path).mtimeMs });
				} catch {
					// The transcript may have disappeared while the directory was scanned.
				}
			}
		}
	}
	const ordered = [...candidates.values()].sort((left, right) => right.modified - left.modified);
	if (ordered.length === 0) throw new Error(`transcript for active session ${session.sessionId} was not found in OMP session roots`);
	return { path: ordered[0].path, duplicateCount: ordered.length - 1 };
}

function textContent(message: JsonObject): string {
	const content = message.content;
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => object(part))
		.filter((part): part is JsonObject => part !== undefined)
		.filter((part) => ["text", "input_text", "output_text"].includes(string(part.type) ?? ""))
		.map((part) => string(part.text) ?? "")
		.filter(Boolean)
		.join("\n")
		.trim();
}

function transcriptDigest(path: string, messageLimit: number): { messages: TranscriptMessage[]; scanTruncated: boolean; complete: boolean; scannedBytes: number } {
	const size = statSync(path).size;
	const requestedBytes = Math.min(size, MAX_TRANSCRIPT_SCAN_BYTES);
	const start = size - requestedBytes;
	const buffer = Buffer.allocUnsafe(requestedBytes);
	const descriptor = openSync(path, "r");
	let scannedBytes = 0;
	try {
		while (scannedBytes < requestedBytes) {
			const count = readSync(descriptor, buffer, scannedBytes, requestedBytes - scannedBytes, start + scannedBytes);
			if (count === 0) break;
			scannedBytes += count;
		}
	} finally {
		closeSync(descriptor);
	}
	let text = buffer.subarray(0, scannedBytes).toString("utf8");
	if (start > 0) {
		const firstNewline = text.indexOf("\n");
		text = firstNewline < 0 ? "" : text.slice(firstNewline + 1);
	}
	const messages: TranscriptMessage[] = [];
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line) continue;
		let event: JsonObject | undefined;
		try {
			event = object(JSON.parse(line));
		} catch {
			continue;
		}
		if (string(event?.type) !== "message") continue;
		const message = object(event?.message);
		const role = string(message?.role);
		if (role !== "user" && role !== "assistant") continue;
		const content = message ? textContent(message) : "";
		if (!content) continue;
		const truncated = content.length > MAX_DIGEST_MESSAGE_CHARS;
		messages.push({
			timestamp: string(event?.timestamp),
			role,
			text: truncated ? `${content.slice(0, MAX_DIGEST_MESSAGE_CHARS)}\n… message truncated` : content,
			truncated,
		});
		if (messages.length >= messageLimit) break;
	}
	messages.reverse();
	return { messages, scanTruncated: start > 0, complete: messages.length >= messageLimit, scannedBytes };
}

function displayPath(path: string): string {
	const home = homedir();
	return path === home ? "~" : path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

function selectSession(sessions: InternalSession[], prefix: string): InternalSession {
	const matches = sessions.filter((session) => session.sessionId === prefix || session.sessionId.startsWith(prefix));
	if (matches.length === 0) throw new Error(`active peer session ${prefix} was not found in the selected scope`);
	if (matches.length > 1) throw new Error(`session prefix ${prefix} is ambiguous; provide more of the session ID`);
	return matches[0];
}

export function makeAgentsExecute(toolOptions: AgentToolOptions = {}): ToolRegistration["execute"] {
	const request = toolOptions.request ?? requestV2;
	const environment = toolOptions.environment ?? process.env;
	return async (_id, params, signal) => {
		const action = typeof params.action === "string" ? params.action : "invalid";
		try {
			const requestedAction = actionOf(params);
			if (requestedAction !== "list" && requestedAction !== "digest") {
				throw new Error(`unsupported cmux_agents action: ${action}`);
			}
			const includeSelf = optionalBoolean(params, "include_self") ?? false;
			const discovered = await discoverSessions(
				params,
				request,
				{ environment: toolOptions.environment, timeoutMs: toolOptions.timeoutMs, signal },
				environment,
			);
			const sessions = includeSelf
				? discovered.sessions
				: discovered.sessions.filter((session) => session.isSelf !== true);
			if (action === "list") {
				const offset = optionalInteger(params, "offset", 0, 10_000) ?? 0;
				const limit = optionalInteger(params, "limit", 1, 25) ?? 25;
				const listedSessions = sessions.slice(offset, offset + limit);
				const nextOffset = offset + listedSessions.length;
				const result = {
					scope: discovered.selection.source,
					selfIdentification: environment.CMUX_SURFACE_ID ? "caller-environment" : "unavailable",
					totalCount: sessions.length,
					offset,
					count: listedSessions.length,
					truncated: nextOffset < sessions.length,
					nextOffset: nextOffset < sessions.length ? nextOffset : null,
					sessions: listedSessions.map(publicSession),
				};
				return {
					content: [{ type: "text", text: clipOutput(JSON.stringify(result, null, 2)) }],
					details: { action, transport: "socket", count: listedSessions.length, totalCount: sessions.length },
				};
			}
			const prefix = optionalString(params, "session");
			if (!prefix) throw new Error("session is required");
			const messageLimit = optionalInteger(params, "messages", 1, 20) ?? 8;
			const session = selectSession(sessions, prefix);
			const transcript = findTranscript(session, toolOptions.sessionRoots);
			const digest = transcriptDigest(transcript.path, messageLimit);
			const result = {
				session: publicSession(session),
				transcript: displayPath(transcript.path),
				duplicateTranscriptsIgnored: transcript.duplicateCount,
				requestedMessages: messageLimit,
				scanTruncated: digest.scanTruncated,
				scannedBytes: digest.scannedBytes,
				complete: digest.complete,
				messages: digest.messages,
			};
			return {
				content: [{ type: "text", text: clipOutput(JSON.stringify(result, null, 2)) }],
				details: { action, transport: "socket", sessionId: session.sessionId },
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: clipOutput(`cmux agents failed: ${reason}`) }],
				details: { action, transport: "socket" },
				isError: true,
			};
		}
	};
}
