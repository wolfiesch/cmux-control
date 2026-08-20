import type { Params } from "../types";
import {
	actionOf,
	optionalInteger,
	optionalString,
	pushFocus,
	pushOptional,
	pushTargets,
	requireAtMostOne,
	requireOne,
	requiredString,
} from "../validation";

function pushPlacement(args: string[], params: Params): void {
	const placement = optionalString(params, "placement");
	if (placement === undefined) return;
	if (placement !== "workspace" && placement !== "dock") {
		throw new Error("placement must be workspace or dock");
	}
	args.push("--placement", placement);
}

export function buildLayoutArgs(params: Params): string[] {
	switch (actionOf(params)) {
		case "new_window":
			return ["new-window"];
		case "new_workspace": {
			const args = ["new-workspace"];
			pushOptional(args, "--name", optionalString(params, "name"));
			pushOptional(args, "--description", optionalString(params, "description"));
			pushOptional(args, "--cwd", optionalString(params, "cwd"));
			pushOptional(args, "--command", optionalString(params, "command"));
			pushTargets(args, params, ["window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_split": {
			const args = [
				"new-split",
				requiredString(params, "direction"),
				"--workspace",
				requiredString(params, "workspace"),
			];
			pushTargets(args, params, ["surface", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_pane": {
			const args = ["new-pane", "--workspace", requiredString(params, "workspace")];
			const type = optionalString(params, "type") ?? "terminal";
			if (type === "agent-session") throw new Error("new_pane does not support type agent-session; use new_surface");
			pushOptional(args, "--type", type);
			pushOptional(args, "--direction", optionalString(params, "direction"));
			pushOptional(args, "--url", optionalString(params, "url"));
			pushOptional(args, "--profile", optionalString(params, "profile"));
			pushPlacement(args, params);
			pushTargets(args, params, ["window"]);
			pushFocus(args, params);
			return args;
		}
		case "new_surface": {
			const args = ["new-surface", "--pane", requiredString(params, "pane")];
			const type = optionalString(params, "type") ?? "terminal";
			const provider = optionalString(params, "provider");
			const renderer = optionalString(params, "renderer");
			if ((provider !== undefined || renderer !== undefined) && type !== "agent-session") {
				throw new Error("provider and renderer require type agent-session");
			}
			pushOptional(args, "--type", type);
			pushOptional(args, "--url", optionalString(params, "url"));
			pushOptional(args, "--provider", provider);
			pushOptional(args, "--renderer", renderer);
			pushPlacement(args, params);
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_surface": {
			const args = ["move-surface", "--surface", requiredString(params, "surface")];
			requireOne(params, ["pane", "workspace"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["pane", "workspace", "window", "before", "after"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			pushFocus(args, params);
			return args;
		}
		case "reorder_surface": {
			const args = ["reorder-surface", "--surface", requiredString(params, "surface")];
			requireOne(params, ["before", "after", "index"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["before", "after", "workspace", "window"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			return args;
		}
		case "split_off": {
			const args = [
				"split-off",
				"--surface",
				requiredString(params, "surface"),
				requiredString(params, "direction"),
			];
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "resize_pane": {
			const flag = { left: "-L", right: "-R", up: "-U", down: "-D" }[requiredString(params, "direction")];
			if (flag === undefined) throw new Error("direction must be left, right, up, or down");
			const args = ["resize-pane", "--pane", requiredString(params, "pane"), flag];
			pushOptional(args, "--amount", optionalInteger(params, "amount", 1, 500));
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "swap_pane": {
			const args = [
				"swap-pane",
				"--pane",
				requiredString(params, "pane"),
				"--target-pane",
				requiredString(params, "target_pane"),
			];
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "break_pane": {
			const args = ["break-pane"];
			requireOne(params, ["pane", "surface"]);
			pushTargets(args, params, ["pane", "surface", "workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "join_pane": {
			const args = ["join-pane", "--target-pane", requiredString(params, "target_pane")];
			requireOne(params, ["pane", "surface"]);
			pushTargets(args, params, ["pane", "surface", "workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_tab_to_new_workspace": {
			const args = ["move-tab-to-new-workspace", "--surface", requiredString(params, "surface")];
			pushOptional(args, "--title", optionalString(params, "title"));
			pushTargets(args, params, ["workspace", "window"]);
			pushFocus(args, params);
			return args;
		}
		case "move_workspace_to_window": {
			return [
				"move-workspace-to-window",
				"--workspace",
				requiredString(params, "workspace"),
				"--window",
				requiredString(params, "window"),
			];
		}
		case "reorder_workspace": {
			const args = ["reorder-workspace", "--workspace", requiredString(params, "workspace")];
			requireOne(params, ["before", "after", "index"]);
			requireAtMostOne(params, ["before", "after", "index"]);
			pushTargets(args, params, ["before", "after", "window"]);
			pushOptional(args, "--index", optionalInteger(params, "index", 0, 1000));
			return args;
		}
		case "workspace_action": {
			const args = ["workspace-action", "--action", requiredString(params, "name")];
			pushTargets(args, params, ["workspace", "window"]);
			pushOptional(args, "--title", optionalString(params, "title"));
			pushOptional(args, "--color", optionalString(params, "color"));
			pushOptional(args, "--description", optionalString(params, "description"));
			return args;
		}
		case "tab_action": {
			const args = ["tab-action", "--action", requiredString(params, "name")];
			pushTargets(args, params, ["surface", "workspace", "window"]);
			pushOptional(args, "--title", optionalString(params, "title"));
			pushOptional(args, "--url", optionalString(params, "url"));
			return args;
		}
		case "focus_pane": {
			const args = ["focus-pane", "--pane", requiredString(params, "pane")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "focus_window":
			return ["focus-window", "--window", requiredString(params, "window")];
		case "select_workspace": {
			const args = ["select-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "rename_workspace": {
			const args = ["rename-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			args.push(requiredString(params, "title"));
			return args;
		}
		case "rename_tab": {
			const args = ["rename-tab", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			args.push(requiredString(params, "title"));
			return args;
		}
		case "close_surface": {
			const args = ["close-surface", "--surface", requiredString(params, "surface")];
			pushTargets(args, params, ["workspace", "window"]);
			return args;
		}
		case "close_workspace": {
			const args = ["close-workspace", "--workspace", requiredString(params, "workspace")];
			pushTargets(args, params, ["window"]);
			return args;
		}
		case "sidebar_open":
			return ["sidebar", "open", requiredString(params, "sidebar")];
		case "sidebar_select":
			return ["sidebar", "select", requiredString(params, "sidebar")];
		case "close_window":
			return ["close-window", "--window", requiredString(params, "window")];
		default:
			throw new Error(`unsupported cmux_layout action: ${params.action}`);
	}
}
