# cmux-control

Typed control and cross-session awareness for coding agents running in [cmux](https://github.com/manaflow-ai/cmux).

An unofficial, community-maintained integration. It is not affiliated with the cmux project.

## Why this exists

An agent can already shell out to the `cmux` CLI, so control alone is not the interesting part. The scarce capability is **awareness**: cmux is one of the few places where several coding-agent CLIs run side by side inside a single structured, queryable runtime. This extension turns that runtime into a typed API.

### Cross-session awareness

`cmux_agents` lets an agent see the other agent sessions running beside it, then read bounded context from one of them.

- Exact attribution: workspace, pane, surface, working directory, process, and CPU or memory cost.
- Defaults to the caller's own workspace and excludes the calling session, so an agent never reasons about whether a row is itself.
- Covers every agent kind cmux tags, including Claude Code, Codex, Cursor, Gemini, Copilot, Amp, OpenCode, Grok, Kiro, Pi, and Oh My Pi.
- Distinguishes running sessions from merely resumable tabs, so a closed-but-restorable surface is never reported as live.

Discovery works for every agent kind. Transcript digests currently parse Oh My Pi and Pi session logs; for other agents the tool says so explicitly and points at `cmux_state read_screen` instead of guessing a format.

### Control surface

| Tool | Capability | Approval tier |
| --- | --- | --- |
| `cmux_agents` | Active agent sessions by workspace, window, or globally; bounded peer transcript digests | read |
| `cmux_state` | Tree, listings, terminal text, processes, sidebar state, todos, notifications | read |
| `cmux_events` | Bounded event-stream polling with seq resume; named sync points | read |
| `cmux_signal` | Status pills, progress bars, log entries, notifications, todos, status lane | write |
| `cmux_layout` | Create, split, move, reorder, resize, swap, break, join, rename, focus, close | exec |
| `cmux_terminal` | Send text or keys, clear scrollback, respawn a surface process | exec |
| `cmux_browser` | Navigate, snapshot, interact, read page state, tabs, viewport emulation | exec |
| `cmux_rpc` | Raw v2 socket method escape hatch for uncovered surface | exec |

The extension also ships a `cmux-control` skill covering the inspect-first workflow, stable handles, focus discipline, peer-session etiquette, progress signaling, event waiting, the user-owned todo and status-lane policy, and conservative cleanup.

### Compatibility

Runs under both Oh My Pi and Pi from one entrypoint, with a TypeBox schema adapter and a direct-socket fallback when the host exposes no exec API.

## Install

### Oh My Pi (OMP)

```sh
omp install github:wolfiesch/cmux-control
```

### Pi (`@mariozechner/pi`)

Clone or add to your Pi extensions directory (`~/.pi/agent/extensions/` or project `.pi/extensions/`):

```sh
git clone https://github.com/wolfiesch/cmux-control.git
cd cmux-control && bun install
ln -s "$PWD/src/index.ts" ~/.pi/agent/extensions/cmux.ts
```

Requirements:
- Pi or Oh My Pi
- A running cmux instance with automation access
- The `cmux` CLI available on `PATH`

## Example requests

```text
What other agent sessions are running in this workspace right now?

Show me the last six messages from the session working on CI, then tell me
whether its work overlaps the files I am about to touch.

Split this cmux workspace to the right and put a new terminal there.

Create a background workspace for the API server, run bun dev in it, and set a
status pill plus progress while you watch the logs.

Read the last 80 lines from surface:4, then send ctrl+c if the server is still
running.

Poll cmux events after seq 10032 and tell me when the build surface exits.

Open example.com in a cmux browser split, snapshot it, and read the page title.
```

## Design

Most tools call `cmux` through the host's argv-based execution API, so user values remain individual arguments rather than shell-interpolated strings. `cmux_agents`, `cmux_rpc`, and `cmux_events poll` connect directly to cmux's per-user Unix socket, authenticate with the inherited capability or socket password, and use the newline-delimited v2 protocol. `cmux_events wait_for` remains a CLI call because it uses the tmux-compatible command path.

- Listing actions pass `--json --id-format both`, so results carry both stable refs and UUIDs.
- Session discovery joins cmux's live `<agent>.<session-id>` process tags to authoritative surface resume bindings. The tag proves the session is running; the binding supplies identity and working directory.
- Session identity comes from cmux's own structured state, never from reading other processes' environments, so no secret can leak through discovery.
- Session lists return at most 25 rows per call and expose `offset`, `nextOffset`, and `totalCount` for bounded pagination.
- Transcript digests scan at most 8 MiB from the tail, bound each message, and exclude thinking and tool payloads.
- New workspaces, panes, splits, and surfaces default to `focus: false`.
- Terminal input and destructive operations require explicit surface or workspace targets.
- Workspace environment reads are always masked; secret values never enter the transcript.
- Event polls are bounded by count and timeout; a timeout with partial output returns the captured frames.
- Read output is capped at 64 KiB per call.
- Parameter constraints (ranges, enums, mutual exclusions) are advertised in the tool schemas and revalidated before execution.

The extension entrypoint is `src/index.ts`. Tool domains, validation, host execution, schemas, and socket transport live in separate modules under `src/`.

## Development

```sh
bun install
bun run check   # tsc --noEmit
bun test
omp plugin doctor
```

Test against a live cmux instance:

```sh
cmux ping
omp --extension ./src/index.ts
```

## License

MIT
