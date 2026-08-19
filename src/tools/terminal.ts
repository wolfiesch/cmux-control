import type { Params } from "../types";
import { actionOf, optionalString, pushOptional, pushTargets, requiredString } from "../validation";

export function buildTerminalArgs(params: Params): string[] {
	const action = actionOf(params);
	switch (action) {
		case "send_text":
		case "send_key": {
			const args = [action === "send_text" ? "send" : "send-key"];
			args.push("--surface", requiredString(params, "surface"));
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, action === "send_text" ? "text" : "key"));
			return args;
		}
		case "clear_history": {
			const args = ["clear-history", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "respawn": {
			const args = ["respawn-pane", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--command", optionalString(params, "command"));
			return args;
		}
		default:
			throw new Error(`unsupported cmux_terminal action: ${params.action}`);
	}
}
