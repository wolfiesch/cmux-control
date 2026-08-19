import type { Params } from "./types";

export const JSON_PRESENTATION = ["--json", "--id-format", "both"];

export function requiredString(params: Params, key: string): string {
	const value = params[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${key} is required`);
	}
	return value;
}

export function optionalString(params: Params, key: string): string | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${key} must be a non-empty string`);
	}
	return value;
}

export function optionalBoolean(params: Params, key: string): boolean | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
	return value;
}

export function optionalInteger(params: Params, key: string, minimum: number, maximum: number): number | undefined {
	const value = params[key];
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new Error(`${key} must be an integer from ${minimum} through ${maximum}`);
	}
	return value as number;
}

export function requiredNumber(params: Params, key: string, minimum: number, maximum: number): number {
	const value = params[key];
	if (typeof value !== "number" || Number.isNaN(value) || value < minimum || value > maximum) {
		throw new Error(`${key} must be a number from ${minimum} through ${maximum}`);
	}
	return value;
}

export function pushOptional(args: string[], flag: string, value: string | number | undefined): void {
	if (value !== undefined) args.push(flag, String(value));
}

export function pushTargets(args: string[], params: Params, keys: readonly string[]): void {
	for (const key of keys) pushOptional(args, `--${key}`, optionalString(params, key));
}

export function pushFocus(args: string[], params: Params): void {
	args.push("--focus", String(optionalBoolean(params, "focus") ?? false));
}

export function actionOf(params: Params): string {
	return requiredString(params, "action");
}

export function requireOne(params: Params, keys: readonly string[]): void {
	if (!keys.some((key) => params[key] !== undefined)) {
		throw new Error(`one of ${keys.join(", ")} is required`);
	}
}

export function requireAtMostOne(params: Params, keys: readonly string[]): void {
	const present = keys.filter((key) => params[key] !== undefined);
	if (present.length > 1) throw new Error(`only one of ${keys.join(", ")} may be set`);
}
