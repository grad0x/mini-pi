import { describe, expect, it, vi } from "vitest";
import {
  Agent,
  DenyCommandPolicy,
  DenyToolPolicy,
  SessionManager,
  SessionRuntime,
  TraceCollector,
  type AgentHook,
  type AgentTool,
  type AssistantMessage,
  type ModelClient,
  type ModelInput,
  type SessionEntry,
  type SessionStore,
  type ToolCallFinishedEvent,
} from "../src/index.js";

class SequenceModel implements ModelClient {
  readonly generate = vi.fn<(input: ModelInput) => Promise<AssistantMessage>>();

  constructor(responses: AssistantMessage[]) {
    for (const response of responses) {
      this.generate.mockResolvedValueOnce(response);
    }
  }
}

function tool(
  name = "mock_tool",
  execute: AgentTool["execute"] = async () => ({ content: "tool-result" }),
  parameters: AgentTool["parameters"] = {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
): AgentTool {
  return { name, description: `Runs ${name}`, parameters, execute };
}

function callTool(
  name = "mock_tool",
  args: unknown = {},
  id = "call-1",
): AssistantMessage {
  return {
    role: "assistant",
    content: `Calling ${name}`,
    toolCalls: [{ id, name, arguments: args }],
  };
}

function toolFinished(trace: TraceCollector): ToolCallFinishedEvent {
  const event = trace
    .getEvents()
    .find((candidate) => candidate.type === "tool_call_finished");
  if (!event || event.type !== "tool_call_finished") {
    throw new Error("Expected tool_call_finished event");
  }
  return event;
}

class MemorySessionStore implements SessionStore {
  readonly entries = new Map<string, SessionEntry[]>();

  async load(sessionId: string): Promise<SessionEntry[]> {
    return structuredClone(this.entries.get(sessionId) ?? []);
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    const entries = this.entries.get(sessionId) ?? [];
    entries.push(structuredClone(entry));
    this.entries.set(sessionId, entries);
  }
}

describe("tool hooks", () => {
  it("runs before, tool, and after stages for an allowed call", async () => {
    const before = vi.fn(() => undefined);
    const after = vi.fn(() => undefined);
    const execute = vi.fn(async () => ({ content: "allowed-result" }));
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute)],
      hooks: [{ beforeToolCall: before, afterToolCall: after }],
    });

    const result = await agent.prompt("run tool");

    expect(before).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(result.newMessages[2]).toMatchObject({
      role: "tool",
      content: "allowed-result",
    });
  });

  it("blocks a denied tool while preserving a recoverable trajectory", async () => {
    const execute = vi.fn(async () => ({ content: "should not run" }));
    const after = vi.fn(() => undefined);
    const model = new SequenceModel([
      callTool("write_file"),
      { role: "assistant", content: "explained denial" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("write_file", execute)],
      hooks: [new DenyToolPolicy({ deniedTools: ["write_file"] }), { afterToolCall: after }],
    });

    const result = await agent.prompt("write something");

    expect(execute).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(result.newMessages[2]).toMatchObject({
      role: "tool",
      isError: true,
      content: expect.stringContaining("Tool write_file is denied by policy"),
    });
    expect(result.run.status).toBe("completed");
    expect(result.finalMessage.content).toBe("explained denial");
  });

  it("marks blocked tool lifecycle events explicitly", async () => {
    const model = new SequenceModel([
      callTool("write_file"),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("write_file")],
      hooks: [new DenyToolPolicy({ deniedTools: ["write_file"] })],
    });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("blocked event");

    expect(
      trace.getEvents().some((event) => event.type === "tool_call_started"),
    ).toBe(true);
    expect(toolFinished(trace)).toMatchObject({
      isError: true,
      blocked: true,
    });
  });

  it("does not classify a Tool execution failure as blocked", async () => {
    const failingTool = tool("mock_tool", async () => {
      throw new Error("execution failed");
    });
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model, { tools: [failingTool] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("fail tool");

    expect(toolFinished(trace)).toMatchObject({
      isError: true,
      blocked: false,
    });
  });

  it("does not invoke hooks for an unknown tool", async () => {
    const before = vi.fn(() => undefined);
    const after = vi.fn(() => undefined);
    const model = new SequenceModel([
      callTool("unknown_tool"),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model, { hooks: [{ beforeToolCall: before, afterToolCall: after }] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("unknown");

    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(toolFinished(trace)).toMatchObject({ isError: true, blocked: false });
  });

  it("rejects invalid arguments before hooks or Tool execution", async () => {
    const before = vi.fn(() => undefined);
    const execute = vi.fn(async () => ({ content: "should not run" }));
    const numberSchema: AgentTool["parameters"] = {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    };
    const model = new SequenceModel([
      callTool("mock_tool", { value: "wrong" }),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute, numberSchema)],
      hooks: [{ beforeToolCall: before }],
    });

    const result = await agent.prompt("invalid args");

    expect(before).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(result.newMessages[2]).toMatchObject({
      isError: true,
      content: expect.stringContaining("argument value must be a number"),
    });
  });

  it("passes validated arguments to before hooks", async () => {
    const receivedValues: unknown[] = [];
    const hook: AgentHook = {
      beforeToolCall(context) {
        receivedValues.push(context.args.value);
        return undefined;
      },
    };
    const numberSchema: AgentTool["parameters"] = {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    };
    const model = new SequenceModel([
      callTool("mock_tool", { value: 42 }),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", undefined, numberSchema)],
      hooks: [hook],
    });

    await agent.prompt("validated args");

    expect(receivedValues).toEqual([42]);
  });

  it("converts a before hook exception into a recoverable Tool error", async () => {
    const execute = vi.fn(async () => ({ content: "should not run" }));
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute)],
      hooks: [
        {
          beforeToolCall() {
            throw new Error("policy backend unavailable");
          },
        },
      ],
    });

    const result = await agent.prompt("hook error");

    expect(execute).not.toHaveBeenCalled();
    expect(result.newMessages[2]).toMatchObject({
      isError: true,
      content: "beforeToolCall failed: policy backend unavailable",
    });
    expect(result.run.status).toBe("completed");
  });

  it("lets an after hook transform what the next Model call observes", async () => {
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", async () => ({ content: "secret-value" }))],
      hooks: [
        {
          afterToolCall: () => ({ content: "[redacted]" }),
        },
      ],
    });

    const result = await agent.prompt("redact");

    expect(result.newMessages[2]).toMatchObject({ content: "[redacted]" });
    expect(model.generate.mock.calls[1]?.[0].messages.at(-1)).toMatchObject({
      role: "tool",
      content: "[redacted]",
    });
  });

  it("lets an after hook mark a successful result as an error", async () => {
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "handled" },
    ]);
    const agent = new Agent(model, {
      tools: [tool()],
      hooks: [
        {
          afterToolCall: () => ({
            content: "Result rejected",
            isError: true,
          }),
        },
      ],
    });

    const result = await agent.prompt("reject result");

    expect(result.newMessages[2]).toMatchObject({
      content: "Result rejected",
      isError: true,
    });
  });

  it("reports an after hook exception without repeating the effect", async () => {
    const execute = vi.fn(async () => ({ content: "effect completed" }));
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "handled" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute)],
      hooks: [
        {
          afterToolCall() {
            throw new Error("redaction unavailable");
          },
        },
      ],
    });

    const result = await agent.prompt("after error");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.newMessages[2]).toMatchObject({
      isError: true,
      content: "afterToolCall failed: redaction unavailable",
    });
  });

  it("runs multiple hooks in order and passes transformed results forward", async () => {
    const order: string[] = [];
    const hookA: AgentHook = {
      beforeToolCall: () => {
        order.push("before-a");
        return undefined;
      },
      afterToolCall: () => {
        order.push("after-a");
        return { content: "result-a" };
      },
    };
    const hookB: AgentHook = {
      beforeToolCall: () => {
        order.push("before-b");
        return undefined;
      },
      afterToolCall: (context) => {
        order.push(`after-b:${context.result.content}`);
        return { content: "result-b" };
      },
    };
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool()],
      hooks: [hookA, hookB],
    });

    const result = await agent.prompt("ordered hooks");

    expect(order).toEqual([
      "before-a",
      "before-b",
      "after-a",
      "after-b:result-a",
    ]);
    expect(result.newMessages[2]).toMatchObject({ content: "result-b" });
  });

  it("stops the before pipeline at the first blocker", async () => {
    const calls: string[] = [];
    const execute = vi.fn(async () => ({ content: "should not run" }));
    const hooks: AgentHook[] = [
      { beforeToolCall: () => (calls.push("a"), undefined) },
      {
        beforeToolCall: () => {
          calls.push("b");
          return { block: true, reason: "blocked by b" };
        },
      },
      { beforeToolCall: () => (calls.push("c"), undefined) },
    ];
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute)],
      hooks,
    });

    await agent.prompt("first blocker");

    expect(calls).toEqual(["a", "b"]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("awaits an asynchronous before gate", async () => {
    const order: string[] = [];
    const execute = vi.fn(async () => ({ content: "should not run" }));
    const hook: AgentHook = {
      async beforeToolCall() {
        order.push("before-start");
        await Promise.resolve();
        order.push("before-finish");
        return { block: true, reason: "async denial" };
      },
    };
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("mock_tool", execute)],
      hooks: [hook],
    });

    await agent.prompt("async gate");

    expect(order).toEqual(["before-start", "before-finish"]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("persists blocked results as normal Session message entries", async () => {
    const store = new MemorySessionStore();
    const session = await SessionManager.open("blocked-session", store);
    const model = new SequenceModel([
      callTool("write_file"),
      { role: "assistant", content: "explained" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("write_file")],
      hooks: [new DenyToolPolicy({ deniedTools: ["write_file"] })],
    });

    await new SessionRuntime(agent, session).prompt("persist denial");

    const restored = await SessionManager.open("blocked-session", store);
    expect(restored.getMessages().map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(restored.getMessages()[2]).toMatchObject({
      role: "tool",
      isError: true,
      content: expect.stringContaining("denied by policy"),
    });
  });

  it("DenyCommandPolicy uses exact matching and is not a shell parser", async () => {
    const execute = vi.fn(async () => ({ content: "command-result" }));
    const commandSchema: AgentTool["parameters"] = {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
      additionalProperties: false,
    };
    const model = new SequenceModel([
      callTool("run_command", { command: "rm -rf ." }),
      { role: "assistant", content: "blocked handled" },
      callTool("run_command", { command: "rm  -rf ." }, "call-2"),
      { role: "assistant", content: "allowed handled" },
    ]);
    const agent = new Agent(model, {
      tools: [tool("run_command", execute, commandSchema)],
      hooks: [new DenyCommandPolicy({ deniedCommands: ["rm -rf ."] })],
    });

    await agent.prompt("blocked command");
    await agent.prompt("different command string");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ command: "rm  -rf ." });
  });
});
