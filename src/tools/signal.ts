import type { Params } from "../types";
import { actionOf, optionalInteger, optionalString, pushOptional, pushTargets, requiredNumber, requiredString } from "../validation";

export function buildSignalArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "notify": {
			const args = ["notify", "--title", requiredString(params, "title")];
			pushOptional(args, "--subtitle", optionalString(params, "subtitle"));
			pushOptional(args, "--body", optionalString(params, "body"));
			pushTargets(args, params, ["workspace", "surface", "window"]);
			return args;
		}
		case "set_status": {
			const args = ["set-status", requiredString(params, "key"), requiredString(params, "value")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--icon", optionalString(params, "icon"));
			pushOptional(args, "--color", optionalString(params, "color"));
			pushOptional(args, "--priority", optionalInteger(params, "priority", 0, 1000));
			return args;
		}
		case "clear_status": {
			const args = ["clear-status", requiredString(params, "key")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "set_progress": {
			const args = ["set-progress", String(requiredNumber(params, "value", 0, 1))];
			pushOptional(args, "--label", optionalString(params, "label"));
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "clear_progress": {
			const args = ["clear-progress"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "log": {
			const args = ["log"];
			pushOptional(args, "--level", optionalString(params, "level"));
			pushOptional(args, "--source", optionalString(params, "source"));
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, "message"));
			return args;
		}
		case "clear_log": {
			const args = ["clear-log"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "todo_add": {
			const args = ["todo", "add", requiredString(params, "text")];
			pushOptional(args, "--state", optionalString(params, "state"));
			args.push("--origin", optionalString(params, "origin") ?? "agent");
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "todo_check":
		case "todo_uncheck":
		case "todo_start":
		case "todo_rm": {
			const verb = actionOf(params).slice("todo_".length);
			const args = ["todo", verb, requiredString(params, "item")];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "todo_clear": {
			const args = ["todo", "clear"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "workspace_status_set": {
			const args = ["workspace", "status", "set", requiredString(params, "lane")];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "sync_signal":
			return ["wait-for", "-S", requiredString(params, "name")];
		default:
			throw new Error(`unsupported cmux_signal action: ${params.action}`);
	}
}
