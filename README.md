# omp-cmux

Typed [Oh My Pi](https://omp.sh) tools for controlling [cmux](https://github.com/manaflow-ai/cmux) workspaces, panes, surfaces, and terminals.

Agents can already invoke the `cmux` CLI through a shell. This extension gives them a narrower interface with structured arguments, explicit targets, bounded output, approval tiers, and no shell interpolation.

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
| `cmux_state` | Ping, inspect the tree, list resources, read terminal output, check surface health | read |
| `cmux_layout` | Create, split, move, focus, rename, or close cmux resources | exec |
| `cmux_terminal` | Send text or keys to one explicit terminal surface | exec |

The extension also ships a `cmux-control` skill. It teaches agents to inspect before mutating, preserve stable handles, avoid focus theft, verify terminal input, and close only owned resources.

## Example requests

```text
Split this cmux workspace to the right and put a new terminal there.

Create a background workspace for the API server without stealing focus.

Read the last 80 lines from surface:4, then send Ctrl-C if the server is still running.

Move surface:9 into pane:3 and verify the resulting tree.
```

## Design

The tools call `cmux` through OMP's argv-based extension execution API. User values remain individual arguments rather than being concatenated into a shell command.

New workspaces, panes, splits, and surfaces default to `focus: false`. Terminal input and destructive operations require explicit surface or workspace targets. Read output is capped at 64 KiB per call.

## Development

```sh
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
