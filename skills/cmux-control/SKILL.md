---
name: cmux-control
description: This skill should be used when the user asks to "manage cmux panes", "control cmux programmatically", "create a cmux workspace", "split my cmux layout", "open an agent in cmux", "read another cmux terminal", or "send input to a cmux pane".
version: 0.1.0
---

# cmux Control

Use the typed `cmux_state`, `cmux_layout`, and `cmux_terminal` tools to control a live cmux instance without constructing shell commands.

## Control Boundary

Use cmux for visible workspace, pane, surface, browser, and terminal arrangement. Use OMP's native task and agent tools for reasoning-agent coordination unless the user explicitly requests an independent visible agent session.

Treat a new terminal as a terminal, not as a supervised agent. Before launching an independent agent session, establish its working directory, repository ownership, task contract, and completion signal.

## Safe Workflow

1. Call `cmux_state` with `action: "ping"`.
2. Call `cmux_state` with `action: "tree"` and `all: true` to obtain current refs and UUIDs.
3. Choose the smallest resource that fits the request.
4. Pass explicit workspace, pane, and surface refs to every mutation.
5. Leave `focus` unset for background resources. New resources default to no focus.
6. Re-run `cmux_state` after layout changes to verify the actual state.

Prefer short refs such as `workspace:2`, `pane:3`, and `surface:4` within one interaction. Prefer UUIDs when handles must survive list reordering or cross-session handoff.

## Resource Choice

- Create a split for a supporting process beside existing work.
- Create a surface for another terminal, browser, simulator, or native agent session in an existing pane.
- Create a workspace for independent activity with its own working directory and metadata.
- Create separate Git worktrees before placing concurrent writing agents in different workspaces unless file ownership is provably disjoint.

## Terminal Input

Read recent output with `cmux_state` and `action: "read_screen"` before sending input. Always pass an explicit surface. Use `cmux_terminal` with `send_text` for literal input and `send_key` for keys such as `ENTER` or `CTRL_C`.

Read the screen again after sending input. Do not send input to an interactive agent whose current state is unknown.

## Destructive Operations

Treat `close_surface` and `close_workspace` as destructive. Close only resources created by the current workflow or resources the user explicitly identified. Never infer ownership from position or focus state. Inspect recent terminal output before closing a surface that may contain a running process.

## Failure Handling

If `ping` fails, report that no live cmux runtime is reachable. If a handle is stale, inspect the tree again instead of guessing another index. Return cmux diagnostics directly when the CLI rejects an operation.
