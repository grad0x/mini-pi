# Mini Pi

A minimal Agent Harness implementation inspired by Pi.

This project is built to study and validate the core abstractions behind
modern Agent runtimes, including Agent State, Agent Loop, Context, Tool,
Session, Hook and Event.

v0.1 starts from the smallest executable core: Agent + Model + Tool + Loop.

## Current milestone

- Project bootstrap
- Minimal Agent Core
- Minimal Agent Loop
- Workspace-bounded file and command tools
- Runtime-owned tool result correlation and run trajectories
- Session persistence
- JSONL restore

## Not included yet

- Context compiler / compaction
- Branch / navigation
- Operations / events / tracing
- Hooks / policies / approval
- In-flight crash recovery
- SQLite / server / protocol
- Multi-agent

## Session design

`AgentState` holds mutable in-process runtime state. `SessionManager` owns the
durable conversation trajectory, while `JsonlSessionStore` provides the first
append-only persistence backend. `SessionRuntime` coordinates Agent runs with
run-boundary persistence.

Completed and failed runs can be restored between processes. Crash recovery
during an in-flight run is not supported yet.

## Development

```bash
pnpm install
pnpm build
pnpm test
```
