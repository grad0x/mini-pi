# Mini Pi Design Pattern Notes

This document records reusable engineering patterns encountered and validated while studying Pi and implementing Mini Pi.

The goal is not to catalog design patterns exhaustively. Each entry captures a concrete design problem observed in Mini Pi, the pattern used to address it, and the signal that may help recognize the same problem in future systems.

## 1. Runtime State vs Durable State

### Problem

A running system needs mutable state for execution, while work history must survive process restarts and remain recoverable.

Treating these as the same object couples runtime execution to persistence.

### Signal

A system has both frequently changing runtime state and history that must survive process exit or failure.

### Pattern

Separate in-process runtime state from durable state.

### Mini Pi

```text
AgentState = mutable in-process runtime state
Session    = durable conversation trajectory
```

`SessionRuntime` coordinates the boundary between them.

## 2. Mutable State + Immutable Snapshot

### Problem

Runtime state continues to change while downstream logic often needs a stable view of the world for one execution boundary.

### Signal

One component owns mutable state while another component needs a stable execution view that should not be modified accidentally.

### Pattern

Create a defensive snapshot at an explicit boundary.

### Mini Pi

```text
AgentState
    ↓
AgentContext Snapshot
    ↓
ContextCompiler / Hooks
```

Mini Pi uses shallow copies and `Object.freeze` in selected execution contexts. The reusable idea is the boundary, not the specific API.

## 3. Port / Adapter

### Problem

Core runtime logic should not depend directly on one external provider or infrastructure implementation.

### Signal

Core code begins importing provider-specific SDKs, request types, or protocol details.

### Pattern

Define a stable interface owned by the core and implement external integrations as adapters.

### Mini Pi

```text
ModelClient
     ▲
     │
OpenAICompatibleModelClient
```

The real LLM experiment validated this boundary: replacing the deterministic model with an OpenAI-compatible provider required no semantic changes to Agent Core.

## 4. Dependency Inversion

### Problem

High-level runtime behavior becomes coupled to low-level implementation details.

### Signal

Core modules directly construct or import concrete storage, provider, or event implementations.

### Pattern

High-level modules depend on abstractions whose contracts are defined around the needs of the core.

### Mini Pi

Examples include:

```text
ModelClient
SessionStore
AgentEventSource
AgentHook
```

## 5. Capability vs Policy

### Problem

A system must distinguish between what it is technically capable of doing and what it is currently allowed to do.

### Signal

Capability implementations begin accumulating permission, organization, approval, or environment-specific rules.

### Pattern

Separate capability from authorization or policy.

### Mini Pi

```text
AgentTool = capability
DenyToolPolicy / DenyCommandPolicy = policy
```

The same Tool can be reused under different policies.

### Watch Out

Policy is not sandboxing. The real LLM experiment showed that a model can compose shell commands through `run_command`, while exact string denial remains only an illustrative policy mechanism.

## 6. Observer / Event

### Problem

Many external consumers need to observe runtime execution without the runtime depending directly on those consumers.

Typical consumers include UI, tracing, telemetry, evaluation, and logging.

### Signal

Several unrelated modules all need to know when the same core execution event occurs.

### Pattern

The core emits lifecycle events. Observers subscribe independently.

### Mini Pi

```text
Agent / AgentLoop
        ↓ emit
AgentEventEmitter
        ↓ subscribe
AgentEventSource
        ↓
TraceCollector
```

`TraceCollector` depends on the event-source contract rather than the concrete emitter.

### Watch Out

Events observe execution. If a component must change or block execution, use a Hook / Interceptor instead.

## 7. Hook / Interceptor

### Problem

Some concerns must participate in execution rather than merely observe it.

Examples include permission checks, approval gates, result redaction, and policy enforcement.

### Signal

A requirement says “before this effect happens” or “before this result is returned”.

### Pattern

Introduce explicit interception points around the effect boundary.

### Mini Pi

```text
Tool Call
↓
beforeToolCall
↓
Tool.execute
↓
afterToolCall
↓
Tool Result
```

Cross-cutting execution controls remain outside individual Tool implementations.

## 8. Append-only Log

### Problem

Historical state must remain traceable and recoverable without repeatedly rewriting prior history.

### Signal

The system benefits from auditability, replay, debugging, branching, or recovery.

### Pattern

Persist changes by appending immutable records.

### Mini Pi

Session entries are appended to JSONL and linked with `id` / `parentId`.

The durable trajectory stays inspectable and can support future tree and branch semantics.

## 9. Composition Root

### Problem

A system contains many reusable components, but some location must decide which concrete implementations are used together.

### Signal

The system needs one place to answer:

- Which Model?
- Which Tools?
- Which Store?
- Which Policies?
- Which Context strategy?

### Pattern

Create one application-level location responsible for constructing and wiring concrete dependencies.

### Mini Pi

`examples/fix-bug/demo.mjs` and `examples/real-llm-fix-bug/run.mjs` act as Composition Roots for their respective executable scenarios.

They assemble Model, Tools, Policy, Agent, Session, and Trace without pushing application-specific wiring back into Agent Core.

The examples also serve as executable architecture documentation.

## 10. Lifecycle Modeling

### Problem

Long-running execution contains multiple nested units of work that fail, retry, and complete at different levels.

### Signal

It becomes unclear whether a failure belongs to one model call, one Tool effect, one Turn, or the whole user request.

### Pattern

Name lifecycle boundaries explicitly.

### Mini Pi

```text
Session
  └─ Run
      └─ Turn
          └─ Model Call / Tool Call
```

Mini Pi's current Run is not yet a durable Operation. The distinction becomes important once successful execution and durable commit can diverge.

## 11. Independent Verification

### Problem

A model can claim success based on its own observation, but the surrounding application may require a stronger completion condition.

### Signal

“Model said it worked” is being treated as equivalent to “the system verified the outcome”.

### Pattern

Separate Agent-level verification from application-level acceptance.

### Mini Pi

In the real LLM fix-bug experiment, the Agent ran `node --test` and observed PASS. The example still executed the test suite again after the Agent Run.

```text
Agent verification
+
Application acceptance
```

This keeps completion claims separate from externally verified outcomes.

# Recognition Checklist

| Signal | Candidate Pattern |
|---|---|
| Runtime and persistence are becoming coupled | Runtime State vs Durable State |
| A downstream component should not mutate live state | Immutable Snapshot |
| Core code imports one vendor SDK | Port / Adapter |
| High-level code constructs low-level implementations everywhere | Dependency Inversion / Composition Root |
| Capability code contains deployment-specific rules | Capability vs Policy |
| Many modules want to observe one workflow | Observer / Event |
| A concern must block or modify execution | Hook / Interceptor |
| History must be inspectable and recoverable | Append-only Log |
| Failure semantics across nested execution units are unclear | Lifecycle Modeling |
| Model completion is being trusted as final truth | Independent Verification |

These patterns are design tools, not mandatory architecture. Apply them when the underlying problem and constraints justify the additional boundary.
