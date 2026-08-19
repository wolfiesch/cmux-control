import type { Params } from "../types";
import { actionOf, JSON_PRESENTATION, optionalBoolean, optionalInteger, optionalString, pushOptional, pushTargets, requireOne, requiredString } from "../validation";

export function buildStateArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "ping":
			return ["ping"];
		case "capabilities":
			return ["capabilities"];
		case "browser_status":
			return ["--json", "browser-status"];
		case "identify": {
			const args = ["--json", "identify", "--no-caller"];
			pushTargets(args, params, ["workspace", "surface", "window"]);
			return args;
		}
		case "tree": {
			const args = ["--id-format", "both", "tree"];
			const all = optionalBoolean(params, "all") ?? false;
			if (all) {
				if (params.workspace !== undefined || params.window !== undefined) {
					throw new Error("all cannot be combined with workspace or window");
				}
				args.push("--all");
			} else {
				pushTargets(args, params, ["workspace", "window"]);
			}
			return args;
		}
		case "list_windows":
			return [...JSON_PRESENTATION, "list-windows"];
		case "list_workspaces": {
			const args = [...JSON_PRESENTATION, "workspace", "list"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "list_panes": {
			const args = [...JSON_PRESENTATION, "list-panes"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_surfaces": {
			const args = [...JSON_PRESENTATION, "list-pane-surfaces"];
			requireOne(params, ["workspace", "pane"]);
			pushTargets(args, params, ["workspace", "pane", "window"]);
			return args;
		}
		case "current_workspace": {
			const args = [...JSON_PRESENTATION, "current-workspace"];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "read_screen": {
			const args = ["read-screen", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			args.push("--lines", String(optionalInteger(params, "lines", 1, 500) ?? 100));
			if (optionalBoolean(params, "scrollback") ?? false) args.push("--scrollback");
			return args;
		}
		case "surface_health": {
			const args = ["surface-health"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "top": {
			const args = ["top"];
			if (optionalBoolean(params, "all") ?? false) args.push("--all");
			else pushTargets(args, params, ["workspace", "window"]);
			if (optionalBoolean(params, "processes") ?? false) args.push("--processes");
			pushOptional(args, "--sort", optionalString(params, "sort"));
			return args;
		}
		case "find_window": {
			const args = ["find-window"];
			if (optionalBoolean(params, "content") ?? false) args.push("--content");
			args.push(requiredString(params, "query"));
			return args;
		}
		case "todo_list": {
			const args = [...JSON_PRESENTATION, "todo", "list"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "workspace_env": {
			// Values may be secrets: masking is unconditional. Use cmux directly
			// outside the agent when full values are genuinely needed.
			const args = [...JSON_PRESENTATION, "workspace", "env", "--mask"];
			pushTargets(args, params, ["workspace"]);
			return args;
		}
		case "sidebar_state": {
			const args = ["sidebar-state"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_notifications":
			return [...JSON_PRESENTATION, "list-notifications"];
		case "list_status": {
			const args = [...JSON_PRESENTATION, "list-status"];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "list_log": {
			const args = [...JSON_PRESENTATION, "list-log"];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--limit", optionalInteger(params, "limit", 1, 500));
			return args;
		}
		default:
			throw new Error(`unsupported cmux_state action: ${params.action}`);
	}
}
