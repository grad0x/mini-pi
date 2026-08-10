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
- Explicit Agent Run lifecycle
- Agent execution events
- In-memory trace collection
- Tool execution hooks
- Policy gates
- `beforeToolCall` / `afterToolCall` interception
- Deterministic integrated fix-bug acceptance demo
- OpenAI-compatible Chat Completions provider
- Real LLM fix-bug experiment

## Fix Bug Demo

```bash
pnpm install
pnpm demo:fix-bug
```

Each run copies an intentionally broken calculator fixture into a temporary
workspace. The Agent reads the implementation and test with real Mini Pi tools,
applies the minimal fix, runs `node --test`, persists the complete trajectory to
JSONL, restores it from disk, and exercises a denied-command Policy gate.

The demo uses a deterministic `ModelClient`. It validates Mini Pi's Harness
execution path, not LLM reasoning quality.

## Real LLM Demo

The deterministic Fix-Bug Demo validates repeatable Harness correctness. The
Real LLM Fix-Bug Demo uses the same fixture to experiment with a probabilistic
`ModelClient`; its exact Tool trajectory can vary between runs.

Configure any compatible Chat Completions endpoint through environment
variables and run:

```bash
export MINI_PI_LLM_BASE_URL=https://api.deepseek.com
export MINI_PI_LLM_API_KEY=<your-key>
export MINI_PI_LLM_MODEL=deepseek-v4-flash

pnpm demo:real-llm
```

The provider itself contains no DeepSeek-specific behavior. Missing variables
produce an explicit error, and the Demo never falls back to the deterministic
model. Do not commit real API keys; `.env` and `.env.local` are ignored.

## v0.1 architecture

See [Mini Pi v0.1 Architecture](docs/architecture.md) for the current execution
and persistence boundaries. Known acceptance findings are recorded in
[v0.1 Review Notes](docs/v0.1-review-notes.md).

## Capability matrix

| Capability               | v0.1 |
| ------------------------ | ---- |
| Agent State              | Yes  |
| Agent Loop               | Yes  |
| Tool Calling             | Yes  |
| Workspace Tools          | Yes  |
| Argument Validation      | Yes  |
| Session Persistence      | Yes  |
| Restore                  | Yes  |
| Context Projection       | Yes  |
| Run / Turn Lifecycle     | Yes  |
| Events / Trace           | Yes  |
| Hooks                    | Yes  |
| Policy Gate              | Yes  |
| Real LLM Provider        | Yes  |
| In-flight Crash Recovery | No   |
| Durable Operation        | No   |
| Compaction               | No   |
| Branching                | No   |
| Server / Protocol        | No   |
| Multi-agent              | No   |

## Not included yet

- Compaction / summarization / token counting
- Branch / navigation
- Durable operations / durable traces / telemetry
- Interactive approval / durable policy decisions / RBAC
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

## Run and event design

A Run is one prompt execution lifecycle inside a Session. Events observe
execution but do not modify it, and listener failures are isolated from Agent
execution. `TraceCollector` records ordered in-memory events for debugging and
future evaluation.

A Turn is one model response plus the complete sequential tool-call batch
requested by that response.

Runs and traces are not durable operations yet.

## Hook and policy design

Events observe execution. Hooks intercept execution. `beforeToolCall` runs
after tool resolution and argument validation but before an Environment effect
starts. `afterToolCall` can change how a completed result is represented back
to the Agent, but it cannot undo the Environment effect.

Policies are reusable Hook implementations. Async `beforeToolCall` hooks are
the extension point for future human-in-the-loop approval. `DenyCommandPolicy`
is only a demonstration exact-match gate; it is not a security sandbox or a
complete shell security policy.

## Development

```bash
pnpm install
pnpm build
pnpm test
```
