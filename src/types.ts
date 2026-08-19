export type Params = Record<string, unknown>;

export interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

export interface CmuxExec {
	exec(
		command: string,
		args: string[],
		options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
	): Promise<ExecResult>;
}

export interface SchemaNode {
	optional(): SchemaNode;
	describe(text: string): SchemaNode;
	min(value: number): SchemaNode;
	max(value: number): SchemaNode;
	int(): SchemaNode;
}

export interface SchemaBuilder {
	string(): SchemaNode;
	number(): SchemaNode;
	boolean(): SchemaNode;
	enum(values: readonly string[]): SchemaNode;
	object(shape: Record<string, SchemaNode>): SchemaNode;
}

export interface ToolRegistration {
	name: string;
	label: string;
	description: string;
	parameters: SchemaNode;
	loadMode?: "discoverable" | "essential";
	approval?: "read" | "write" | "exec";
	strict?: boolean;
	execute(id: string, params: Params, signal?: AbortSignal): Promise<Record<string, unknown>>;
}

export interface ExtensionAPI {
	exec?(
		command: string,
		args: string[],
		options?: { signal?: AbortSignal; timeout?: number; cwd?: string },
	): Promise<ExecResult>;
	zod?: SchemaBuilder;
	setLabel?(label: string): void;
	registerTool(definition: ToolRegistration): void;
}
