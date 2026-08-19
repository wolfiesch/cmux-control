# Changelog

## [0.2.0] - 2026-08-19

### Added

- `cmux_signal` tool: sidebar status pills, progress bars, log entries, notifications, per-workspace todo items, and the workspace status lane, with the user-ownership policy for todos and manual lanes encoded in the tool description and skill.
- `cmux_events` tool: bounded event-stream polling with `after`/`seq` resume, name and category filters, and tmux-style `wait_for`/`signal` synchronization points. A poll that hits its timeout returns the captured frames instead of an error.
- `cmux_browser` tool: navigation, DOM snapshots, element interaction, page-state reads, dialogs, tabs, console/error listings, and viewport emulation for cmux-owned browser surfaces.
- `cmux_rpc` tool: raw v2 socket method escape hatch with method-shape and JSON-params validation.
- `cmux_layout` actions: `new_window`, `reorder_surface`, `resize_pane`, `swap_pane`, `break_pane`, `join_pane`, `move_tab_to_new_workspace`, `move_workspace_to_window`, `reorder_workspace`, `workspace_action`, `tab_action`, `focus_window`, `close_window`, and `command` on `new_workspace`.
- `cmux_state` actions: `list_windows`, `top`, `find_window`, `todo_list`, `workspace_env` (always masked), `sidebar_state`, `list_notifications`, `list_status`, `list_log`.
- `cmux_terminal` actions: `clear_history`, `respawn`.
- GitHub Actions CI running `tsc --noEmit` and `bun test`.

### Changed

- Listing actions request `--json --id-format both`, so results are machine-parseable and carry both refs and UUIDs.
- Parameter constraints (ranges, enums) are now advertised in the tool schemas instead of only being enforced at runtime.
- Successful commands no longer merge stderr into output; stderr is used only when stdout is empty, which drops legacy-alias notices.
- Errors mentioning unknown commands or options add a cmux version-skew hint.
- Pi and Oh My Pi now share the same TypeBox-compatible extension entrypoint, with OMP-specific APIs treated as optional host capabilities.
- Split the extension monolith into domain modules for registration, schemas, validation, host execution, socket transport, and each tool family.
- `cmux_rpc` and bounded `cmux_events` polling now use cmux's direct Unix socket v2 protocol, including capability/password authentication and socket ownership checks. Other operations retain the argv-based CLI path.

## [0.1.0] - 2026-08-19

### Added

- Initial release: `cmux_state`, `cmux_layout`, and `cmux_terminal` tools plus the `cmux-control` skill.
