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

## Not included yet

- Session persistence
- Context compiler
- Hooks / policies
- Events / tracing
- Server / protocol
- Multi-agent

## Development

```bash
pnpm install
pnpm build
pnpm test
```
