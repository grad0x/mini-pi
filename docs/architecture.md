# Mini Pi v0.1 Architecture

Mini Pi v0.1 is a minimal Agent Harness. The diagram contains only components
implemented in the current repository.

```text
                         User
                          |
                          v
                    SessionRuntime
                     /         \
                    v           v
                 Agent      SessionManager
                   |             |
                   |             v
                   |         SessionStore
                   |             |
                   |             v
                   |           JSONL
                   v
              AgentState
                   |
                   v
         AgentContext Snapshot
                   |
                   v
          ContextCompiler
                   |
                   v
              ModelInput
                   |
                   v
             ModelClient
                   |
                   v
              AgentLoop
                   |
              Tool Call
                   |
          Argument Validation
                   |
                   v
         beforeToolCall Hooks
                   |
                   v
                 Tool
                   |
                   v
             Environment
                   |
                   v
          afterToolCall Hooks
                   |
                   v
             Tool Result

 Agent / AgentLoop
        |
        +------> Run / Turn
        |
        +------> Events
                    |
                    v
              TraceCollector
```

`SessionRuntime` coordinates a prompt run with run-boundary persistence.
`Agent` owns the in-process state and loop. A context snapshot is compiled into
provider-neutral model input; model tool calls pass argument validation and
hooks before reaching a real environment tool. Results are appended to Agent
state and become observations for the next model call.

Events are an observational side channel. They expose Run, Turn, model, and
tool lifecycle data to `TraceCollector` without controlling execution.

## Provider boundary

```text
AgentLoop -> ModelClient <- OpenAICompatibleModelClient
                              |
                              v
                   Chat Completions HTTP API
```

`ModelClient` remains the Core-owned port. The OpenAI-compatible implementation
is an Adapter that translates provider-neutral `ModelInput` and
`AssistantMessage` values at the HTTP boundary; Agent Core does not import its
wire types.
