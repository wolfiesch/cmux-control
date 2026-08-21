---
name: cmux-control
description: This skill should be used when the user asks to "manage cmux panes", "control cmux programmatically", "create a cmux workspace", "split my cmux layout", "open an agent in cmux", "see what other agent sessions are running in this workspace", "read another agent's recent conversation", "read another cmux terminal", "send input to a cmux pane", "show progress in cmux", "wait for a cmux event", or "drive the cmux browser".
version: 0.4.0
---

# cmux Control

Use the typed cmux tools to control a live cmux instance without constructing shell commands:

| Tool | Purpose |
| --- | --- |
| `cmux_state` | Read-only inspection: tree, listings, terminal text, processes, sidebar, todos |
| `cmux_agents` | Discover active agent sessions and read bounded peer conversation digests |
| `cmux_layout` | Create, split, move, resize, swap, reorder, rename, focus, close |
| `cmux_terminal` | Send text or keys, clear scrollback, respawn a surface process |
| `cmux_signal` | Status pills, progress, log entries, notifications, todos, status lane |
| `cmux_events` | Poll the event stream with resume sequences; named sync points |
| `cmux_browser` | Drive cmux-owned browser surfaces |
| `cmux_rpc` | Raw v2 socket method escape hatch |

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

Listing actions return JSON with both refs and UUIDs. Mutations print `OK <ref>` lines. Prefer short refs such as `workspace:2` within one interaction; prefer UUIDs when handles must survive reordering or cross-session handoff.

## Agent Sessions

Use `cmux_agents` `list` when the task depends on another visible agent session. Its default scope is the caller's workspace and it excludes the caller. Pass an explicit `workspace`, `window`, or `all: true` only when the request requires broader context.

Discovery spans every agent runtime cmux tags, not just this host: Claude Code, Codex, Cursor, Gemini, Copilot, Amp, OpenCode, and others appear beside Oh My Pi and Pi sessions, each carrying its `kind` and display name. Only sessions with a live process are listed, so a resumable but stopped surface never appears.

Use `digest` with an exact session ID or unambiguous prefix to read recent conversational messages. Prefer the smallest useful `messages` value. Digests exclude thinking and tool payloads and scan a bounded transcript tail.

`digest` parses Oh My Pi and Pi session logs only. For any other agent kind it fails and names the agent; read that session's live output with `read_screen` on the surface from the `list` result instead.

Do not read adjacent sessions speculatively. Use workspace peers when the user asks, when another visible session owns directly relevant context, or when concurrent work may overlap. Peer transcripts are the user's other conversations, so take what the task needs and nothing more.

### Optional Completion-First Pruning

Use this flow only when the user asks to investigate resource pressure, stale sessions, or active-agent sprawl. It is overkill for routine cmux work.

1. Use `cmux_state` `top` to establish whether cmux sessions materially contribute to CPU or memory pressure, then use `cmux_agents` `list` at the narrowest useful scope. Broaden to `all: true` only for machine-wide diagnosis.
2. Treat an `Idle` workspace as a candidate, not proof that its work is disposable. Prioritize candidates by resource impact instead of reading every transcript.
3. For each candidate, request the smallest useful `digest`. A final assistant delivery that reports completed work with no later user request is positive evidence. Pending commands, waits, unresolved next steps, or ambiguous state mean keep the session. For runtimes that `digest` cannot parse, inspect the exact surface with `read_screen`.
4. Before closing a workspace, verify every agent and non-agent surface it contains. If a workspace mixes completed and live work, close only the exact completed surface when the user authorizes it.
5. Present the evidence-backed set separately from uninspected idle sessions and obtain explicit authorization before closing existing resources. Keep running or ambiguous work untouched.
6. Close exact refs, then re-list sessions and re-measure the pressure signal that motivated cleanup. Report measured change; do not equate attributed session memory with guaranteed physical RAM recovery.

## Resource Choice

- Create a split for a supporting process beside existing work.
- Create a surface for another terminal, browser, simulator, or native agent session in an existing pane.
- Create a workspace for independent activity with its own working directory and metadata.
- Create separate Git worktrees before placing concurrent writing agents in different workspaces unless file ownership is provably disjoint.
- Create a Dock tab (`placement: "dock"` on `new_pane`/`new_surface`) for a persistent watcher, log tail, or dashboard beside every workspace in the window. Dock handles work with the normal read, send, and close actions.
- Manage interpreted custom sidebars with `sidebar_validate` (cmux_state), then `sidebar_open` to show one as a pane or `sidebar_select` to preview it in the left sidebar.

## Terminal Input

Read recent output with `cmux_state` and `action: "read_screen"` before sending input. Always pass an explicit surface. Use `send_text` for literal input and `send_key` for keys such as `enter` or `ctrl+c`. Read the screen again after sending input. Do not send input to an interactive agent whose current state is unknown.

## Progress Signaling

Prefer `cmux_signal` over silent background work when a human watches the cmux sidebar:

- `set_status` and `set_progress` for coarse task state; clear them when done.
- `log` for timestamped step entries.
- `notify` for completion or attention; keep text factual and free of secrets.

The per-workspace todo checklist and the manual workspace status lane belong to the user. Do not add, edit, complete, or clear todo items, and do not pin the status lane, unless the user explicitly asks for that surface to be managed. Agent-created todo items must keep `origin: agent` (the default).

## Waiting on Events

To react to cmux activity, use `cmux_events`:

- `poll` blocks until `limit` events arrive or `timeout` elapses; a timeout with partial output is a normal bounded read, not an error. The ack frame carries `resume.latest_seq`; pass the last seen `seq` as `after` on the next poll to resume without gaps.
- `wait_for` blocks on a tmux-style named synchronization point; release it with `cmux_signal` `sync_signal` from the other side.

Prefer one bounded poll over repeated `read_screen` sampling when waiting for surface lifecycle changes.

## Browser Surfaces

Snapshot before interacting. cmux browser profiles do not share cookies with Chrome, OMP's native browser tool, or other automation stacks. Use element-scoped actions and `wait` for navigation or state changes. Capture screenshots only when visual evidence is required. Avoid purchases, sends, deletions, or permission grants without explicit confirmation.

Browser creation can be globally disabled in cmux. Creating a browser pane or surface then reports success without creating anything. Verify with `cmux_state` `tree` after creation, and check `cmux_state` `browser_status` when an expected browser surface is missing.

## Destructive Operations

Treat `close_surface`, `close_workspace`, `close_window`, `respawn`, `clear_history`, `todo_clear`, and destructive `workspace_action`/`tab_action` names (`close-others`, `close-above`, `close-below`, `close-left`, `close-right`) as destructive. Close only resources created by the current workflow or resources the user explicitly identified. Inspect recent terminal output before closing or respawning a surface that may contain a running process.

## Escape Hatch

`cmux_rpc` reaches any v2 socket method (`cmux_state` `capabilities` lists them). Prefer the typed tools; use rpc for uncovered surface such as `workspace.equalize_splits` or `comments.list`. The same ownership and destructiveness rules apply.

## Failure Handling

If `ping` fails, report that no live cmux runtime is reachable. If a handle is stale, inspect the tree again instead of guessing another index. When an error suggests the installed cmux CLI is older than this extension, report the version mismatch rather than retrying.
