import { clipOutput, executeCmux, OUTPUT_LIMIT } from "../exec";
import { streamV2, type SocketRequestOptions } from "../transport";
import type { CmuxExec, Params, ToolRegistration } from "../types";
import { actionOf, optionalInteger, optionalString, pushOptional, requiredString } from "../validation";

interface EventPoll {
	after?: number;
	limit: number;
	names: string[];
	categories: string[];
	timeoutMs: number;
}

function stringArray(params: Params, key: string): string[] {
	const value = params[key];
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
		throw new Error(`${key} must be an array of non-empty strings`);
	}
	return value as string[];
}

function parseEventPoll(params: Params): EventPoll {
	const names = stringArray(params, "names");
	const name = optionalString(params, "name");
	if (name) names.push(name);
	const categories = stringArray(params, "categories");
	const category = optionalString(params, "category");
	if (category) categories.push(category);
	return {
		after: optionalInteger(params, "after", 0, Number.MAX_SAFE_INTEGER),
		limit: optionalInteger(params, "limit", 1, 200) ?? 20,
		names,
		categories,
		timeoutMs: (optionalInteger(params, "timeout", 1, 300) ?? 30) * 1000,
	};
}

export function buildEventsArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "poll": {
			const poll = parseEventPoll(params);
			const args = ["events", "--no-heartbeat"];
			pushOptional(args, "--after", poll.after);
			args.push("--limit", String(poll.limit));
			for (const name of poll.names) args.push("--name", name);
			for (const category of poll.categories) args.push("--category", category);
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

function eventFrame(line: string): Record<string, unknown> {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new Error("invalid JSON event stream frame");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("invalid event stream frame");
	}
	const frame = value as Record<string, unknown>;
	if (frame.ok === false) {
		const error = frame.error;
		const message =
			error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
				? (error as Record<string, unknown>).message
				: "event stream error";
		throw new Error(String(message));
	}
	return frame;
}

export function makeEventsExecute(
	execApi: CmuxExec,
	socketOptions: SocketRequestOptions = {},
): ToolRegistration["execute"] {
	return async (_id, params, signal) => {
		const action = typeof params.action === "string" ? params.action : "invalid";
		try {
			const resolvedAction = actionOf(params);
			if (resolvedAction === "wait_for") {
				const timeout = optionalInteger(params, "timeout", 1, 300) ?? 30;
				return await executeCmux(execApi, action, buildEventsArgs(params), {
					signal,
					timeoutMs: (timeout + 5) * 1000,
				});
			}
			if (resolvedAction !== "poll") {
				throw new Error(`unsupported cmux_events action: ${resolvedAction}`);
			}

			const poll = parseEventPoll(params);
			let output = "";
			let sawOutput = false;
			let eventCount = 0;
			const streamParams: Record<string, unknown> = { include_heartbeats: true };
			if (poll.after !== undefined) streamParams.after_seq = poll.after;
			if (poll.names.length > 0) streamParams.names = poll.names;
			if (poll.categories.length > 0) streamParams.categories = poll.categories;

			const stream = await streamV2(
				"events.stream",
				streamParams,
				(line) => {
					const frame = eventFrame(line);
					if (frame.type === "heartbeat") return true;
					sawOutput = true;
					if (output.length <= OUTPUT_LIMIT) {
						const separator = output.length === 0 ? "" : "\n";
						output += `${separator}${line}`.slice(0, OUTPUT_LIMIT + 1 - output.length);
					}
					if (frame.type === "event") {
						if (!Number.isSafeInteger(frame.seq) || (frame.seq as number) < 0) {
							throw new Error("invalid event stream frame: event missing numeric seq");
						}
						eventCount += 1;
					}
					return eventCount < poll.limit;
				},
				{ ...socketOptions, signal, timeoutMs: poll.timeoutMs },
			);

			if (stream.timedOut && !sawOutput) {
				throw new Error("timed out before cmux returned an event stream frame");
			}
			const marker = stream.timedOut ? "\n[stream closed at timeout]" : "";
			return {
				content: [{ type: "text", text: clipOutput(`${output}${marker}`) }],
				details: { action, eventCount, timedOut: stream.timedOut, transport: "socket" },
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: clipOutput(`cmux ${action} failed: ${reason}`) }],
				details: { action, transport: action === "wait_for" ? "cli" : "socket" },
				isError: true,
			};
		}
	};
}
