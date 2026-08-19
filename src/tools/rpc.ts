import { clipOutput } from "../exec";
import { requestV2, type SocketRequestOptions } from "../transport";
import type { Params, ToolRegistration } from "../types";
import { optionalString, requiredString } from "../validation";

export interface RpcRequest {
	method: string;
	params: Record<string, unknown>;
	rawParams?: string;
}

export function parseRpcRequest(params: Params): RpcRequest {
	const method = requiredString(params, "method");
	if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(method)) {
		throw new Error("method must be a dotted lowercase v2 method name such as workspace.list");
	}
	const rawParams = optionalString(params, "params");
	if (rawParams === undefined) return { method, params: {} };
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawParams);
	} catch {
		throw new Error("params must be a valid JSON document");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("params must be a JSON object");
	}
	return { method, params: parsed as Record<string, unknown>, rawParams };
}

export function buildRpcArgs(params: Params): string[] {
	const request = parseRpcRequest(params);
	return request.rawParams === undefined
		? ["rpc", request.method]
		: ["rpc", request.method, request.rawParams];
}

export function makeRpcExecute(socketOptions: SocketRequestOptions = {}): ToolRegistration["execute"] {
	return async (_id, params, signal) => {
		try {
			const request = parseRpcRequest(params);
			const result = await requestV2(request.method, request.params, { ...socketOptions, signal });
			return {
				content: [{ type: "text", text: clipOutput(JSON.stringify(result, null, 2) ?? "null") }],
				details: { action: "rpc", method: request.method, transport: "socket" },
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: clipOutput(`cmux rpc failed: ${reason}`) }],
				details: { action: "rpc", transport: "socket" },
				isError: true,
			};
		}
	};
}
