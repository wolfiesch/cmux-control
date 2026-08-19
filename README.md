# omp-cmux

Typed [Oh My Pi](https://omp.sh) tools for controlling [cmux](https://github.com/manaflow-ai/cmux) end to end: windows, workspaces, panes, surfaces, terminals, the sidebar, the event stream, and cmux-owned browser surfaces.

Agents can already invoke the `cmux` CLI through a shell. This extension gives them a narrower interface with structured arguments, explicit targets, JSON output, bounded reads, approval tiers, and no shell interpolation.

## Install

```sh
omp install github:wolfiesch/omp-cmux
```

For local development:

```sh
omp install /path/to/omp-cmux
```

Requirements:

- Oh My Pi 17.3.4 or newer
- A running cmux instance with automation access
- The `cmux` CLI available on `PATH`

## Tools

| Tool | Capability | Approval tier |
| --- | --- | --- |
| `cmux_state` | Tree, listings, terminal text, processes, sidebar state, todos, notifications | read |
| `cmux_layout` | Create, split, move, reorder, resize, swap, break, join, rename, focus, close | exec |
| `cmux_terminal` | Send text or keys, clear scrollback, respawn a surface process | exec |
| `cmux_signal` | Status pills, progress bars, log entries, notifications, todos, status lane | write |
| `cmux_events` | Bounded event-stream polling with seq resume; named sync points | read |
| `cmux_browser` | Navigate, snapshot, interact, read page state, tabs, viewport emulation | exec |
| `cmux_rpc` | Raw v2 socket method escape hatch for uncovered surface | exec |

The extension also ships a `cmux-control` skill covering the inspect-first workflow, stable handles, focus discipline, progress signaling, event waiting, the user-owned todo/status-lane policy, and conservative cleanup.

## Example requests

```text
Split this cmux workspace to the right and put a new terminal there.

Create a background workspace for the API server, run bun dev in it, and set a
status pill plus progress while you watch the logs.

Read the last 80 lines from surface:4, then send ctrl+c if the server is still
running.

Poll cmux events after seq 10032 and tell me when the build surface exits.

Open example.com in a cmux browser split, snapshot it, and read the page title.
```

## Design

The tools call `cmux` through OMP's argv-based extension execution API. User values remain individual arguments rather than being concatenated into a shell command.

- Listing actions pass `--json --id-format both`, so results carry both stable refs and UUIDs.
- New workspaces, panes, splits, and surfaces default to `focus: false`.
- Terminal input and destructive operations require explicit surface or workspace targets.
- Workspace environment reads are always masked; secret values never enter the transcript.
- Event polls are bounded by count and timeout; a timeout with partial output returns the captured frames.
- Read output is capped at 64 KiB per call.
- Parameter constraints (ranges, enums, mutual exclusions) are advertised in the tool schemas and revalidated before execution.

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
omp --extension ./index.ts
```

## License

MIT
