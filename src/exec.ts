import type { CmuxExec, Params, ToolRegistration } from "./types";

export const OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface RunOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
	/** Treat a timeout kill with captured output as a successful bounded read (event streams). */
	acceptTimeout?: boolean;
}

export function clipOutput(value: string): string {
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

export function makeExecute(
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
