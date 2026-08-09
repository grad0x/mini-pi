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
- Agent context snapshots
- Context compiler
- Recent-run context projection

## Not included yet

- Compaction / summarization / token counting
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

If durable persistence fails, `SessionRuntime` becomes faulted and must be
discarded and restored before conversation can continue.

## Context design

`SessionManager` stores the complete durable trajectory. `AgentState` holds the
complete in-process transcript. `AgentContext` is a stable top-level snapshot
created before each model call, and `ContextCompiler` decides which parts of
that runtime state become `ModelInput`.

Context projection never deletes or rewrites durable session history.

## Development

```bash
pnpm install
pnpm build
pnpm test
```
