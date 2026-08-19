import type { Params } from "../types";
import { actionOf, optionalBoolean, optionalInteger, optionalString, pushFocus, pushOptional, requireOne, requiredString } from "../validation";

const BROWSER_SELECTOR_ACTIONS: Record<string, string> = {
	click: "click",
	dblclick: "dblclick",
	hover: "hover",
	focus: "focus",
	check: "check",
	uncheck: "uncheck",
	scroll_into_view: "scroll-into-view",
	highlight: "highlight",
};

const BROWSER_BARE_ACTIONS: Record<string, string[]> = {
	back: ["back"],
	forward: ["forward"],
	reload: ["reload"],
	get_url: ["get-url"],
	tab_list: ["tab", "list"],
	console_list: ["console", "list"],
	errors_list: ["errors", "list"],
};

export function buildBrowserArgs(params: Params): string[] {
	const args = ["browser"];
	pushOptional(args, "--surface", optionalString(params, "surface"));
	const action = actionOf(params);

	const selectorSub = BROWSER_SELECTOR_ACTIONS[action];
	if (selectorSub !== undefined) {
		args.push(selectorSub, requiredString(params, "selector"));
		return args;
	}
	const bareSub = BROWSER_BARE_ACTIONS[action];
	if (bareSub !== undefined) {
		args.push(...bareSub);
		return args;
	}

	switch (action) {
		case "open": {
			args.push("open");
			const url = optionalString(params, "url");
			if (url !== undefined) args.push(url);
			pushOptional(args, "--profile", optionalString(params, "profile"));
			pushFocus(args, params);
			return args;
		}
		case "navigate":
			args.push("navigate", requiredString(params, "url"));
			return args;
		case "snapshot": {
			args.push("snapshot");
			if (optionalBoolean(params, "interactive") ?? true) args.push("--interactive");
			if (optionalBoolean(params, "compact") ?? false) args.push("--compact");
			pushOptional(args, "--max-depth", optionalInteger(params, "max_depth", 1, 100));
			pushOptional(args, "--selector", optionalString(params, "selector"));
			return args;
		}
		case "wait": {
			args.push("wait");
			requireOne(params, ["selector", "text", "url_contains", "load_state", "function"]);
			pushOptional(args, "--selector", optionalString(params, "selector"));
			pushOptional(args, "--text", optionalString(params, "text"));
			pushOptional(args, "--url-contains", optionalString(params, "url_contains"));
			pushOptional(args, "--load-state", optionalString(params, "load_state"));
			pushOptional(args, "--function", optionalString(params, "function"));
			pushOptional(args, "--timeout-ms", optionalInteger(params, "timeout_ms", 100, 60_000));
			return args;
		}
		case "type":
			args.push("type", requiredString(params, "selector"), requiredString(params, "text"));
			return args;
		case "fill":
			// Empty text clears the input, so text is optional here.
			args.push("fill", requiredString(params, "selector"), optionalString(params, "text") ?? "");
			return args;
		case "press":
			args.push("press", requiredString(params, "key"));
			return args;
		case "select":
			args.push("select", requiredString(params, "selector"), requiredString(params, "value"));
			return args;
		case "scroll": {
			args.push("scroll");
			pushOptional(args, "--selector", optionalString(params, "selector"));
			pushOptional(args, "--dx", optionalInteger(params, "dx", -10_000, 10_000));
			pushOptional(args, "--dy", optionalInteger(params, "dy", -10_000, 10_000));
			return args;
		}
		case "screenshot": {
			args.push("screenshot", "--json");
			pushOptional(args, "--out", optionalString(params, "out"));
			return args;
		}
		case "get": {
			const what = requiredString(params, "what");
			args.push("get", what);
			if (what === "url" || what === "title") return args;
			args.push(requiredString(params, "selector"));
			if (what === "attr") args.push(requiredString(params, "name"));
			return args;
		}
		case "is":
			args.push("is", requiredString(params, "check"), requiredString(params, "selector"));
			return args;
		case "find":
			args.push("find", requiredString(params, "by"), requiredString(params, "query"));
			return args;
		case "eval":
			args.push("eval", requiredString(params, "script"));
			return args;
		case "dialog": {
			args.push("dialog", requiredString(params, "response"));
			const text = optionalString(params, "text");
			if (text !== undefined) args.push(text);
			return args;
		}
		case "tab_new": {
			args.push("tab", "new");
			const url = optionalString(params, "url");
			if (url !== undefined) args.push(url);
			return args;
		}
		case "tab_switch":
			args.push("tab", "switch", String(optionalInteger(params, "index", 0, 100) ?? 0));
			return args;
		case "tab_close": {
			args.push("tab", "close");
			const index = optionalInteger(params, "index", 0, 100);
			if (index !== undefined) args.push(String(index));
			return args;
		}
		case "viewport": {
			if (optionalBoolean(params, "reset") ?? false) {
				args.push("viewport", "reset");
				return args;
			}
			args.push(
				"viewport",
				String(optionalInteger(params, "width", 1, 4096) ?? 1280),
				String(optionalInteger(params, "height", 1, 4096) ?? 800),
			);
			return args;
		}
		default:
			throw new Error(`unsupported cmux_browser action: ${params.action}`);
	}
}
