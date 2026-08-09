import { describe, expect, it, vi } from "vitest";
import {
  Agent,
  MaxTurnsExceededError,
  SessionManager,
  SessionRuntime,
  TraceCollector,
  type AgentEvent,
  type AgentTool,
  type AssistantMessage,
  type ModelClient,
  type ModelInput,
  type SessionEntry,
  type SessionStore,
  type ToolCallFinishedEvent,
  type ToolCallStartedEvent,
} from "../src/index.js";

class SequenceModel implements ModelClient {
  readonly generate = vi.fn<(input: ModelInput) => Promise<AssistantMessage>>();

  constructor(responses: AssistantMessage[]) {
    for (const response of responses) {
      this.generate.mockResolvedValueOnce(response);
    }
  }
}

function tool(name = "mock_tool", execute: AgentTool["execute"] = async () => ({
  content: `${name}-result`,
})): AgentTool {
  return {
    name,
    description: `Runs ${name}`,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute,
  };
}

function callTool(name = "mock_tool", id = "call-1"): AssistantMessage {
  return {
    role: "assistant",
    content: `Calling ${name}`,
    toolCalls: [{ id, name, arguments: {} }],
  };
}

function eventTypes(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type);
}

describe("Agent events", () => {
  it("emits the plain response lifecycle in strict order", async () => {
    const model = new SequenceModel([{ role: "assistant", content: "done" }]);
    const agent = new Agent(model);
    const trace = new TraceCollector();
    trace.subscribe(agent);

    const result = await agent.prompt("hello");

    expect(eventTypes(trace.getEvents())).toEqual([
      "run_started",
      "turn_started",
      "model_call_started",
      "model_call_finished",
      "turn_finished",
      "run_finished",
    ]);
    expect(result.run.status).toBe("completed");
    expect(result.run.endedAt).toBeGreaterThanOrEqual(result.run.startedAt);
  });

  it("emits tool events between model and turn lifecycle events", async () => {
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, { tools: [tool()] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("use tool");

    expect(eventTypes(trace.getEvents())).toEqual([
      "run_started",
      "turn_started",
      "model_call_started",
      "model_call_finished",
      "tool_call_started",
      "tool_call_finished",
      "turn_finished",
      "turn_started",
      "model_call_started",
      "model_call_finished",
      "turn_finished",
      "run_finished",
    ]);
  });

  it("executes and reports multiple tool calls sequentially in source order", async () => {
    const model = new SequenceModel([
      {
        role: "assistant",
        content: "Calling two tools",
        toolCalls: [
          { id: "call-a", name: "tool_a", arguments: {} },
          { id: "call-b", name: "tool_b", arguments: {} },
        ],
      },
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, { tools: [tool("tool_a"), tool("tool_b")] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("use both");

    const toolEvents = trace
      .getEvents()
      .filter(
        (
          event,
        ): event is ToolCallStartedEvent | ToolCallFinishedEvent =>
          event.type === "tool_call_started" ||
          event.type === "tool_call_finished",
      );
    expect(toolEvents.map((event) => [event.type, event.toolCallId])).toEqual([
      ["tool_call_started", "call-a"],
      ["tool_call_finished", "call-a"],
      ["tool_call_started", "call-b"],
      ["tool_call_finished", "call-b"],
    ]);
    expect(toolEvents.every((event) => event.turn === 1)).toBe(true);
  });

  it("reports a thrown tool error without failing a recovered run", async () => {
    const failingTool = tool("mock_tool", async () => {
      throw new Error("tool failed");
    });
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model, { tools: [failingTool] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    const result = await agent.prompt("recover");

    const toolFinished = trace
      .getEvents()
      .find((event) => event.type === "tool_call_finished");
    const runFinished = trace.getEvents().at(-1);
    expect(toolFinished).toMatchObject({ isError: true });
    expect(runFinished).toMatchObject({
      type: "run_finished",
      status: "completed",
    });
    expect(result.run.status).toBe("completed");
  });

  it("reports an unknown tool as an error and continues", async () => {
    const model = new SequenceModel([
      callTool("unknown_tool", "unknown-1"),
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model);
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("try unknown");

    expect(
      trace
        .getEvents()
        .filter((event) => event.type.startsWith("tool_call")),
    ).toEqual([
      expect.objectContaining({
        type: "tool_call_started",
        toolName: "unknown_tool",
      }),
      expect.objectContaining({
        type: "tool_call_finished",
        toolName: "unknown_tool",
        isError: true,
      }),
    ]);
    expect(trace.getEvents().at(-1)).toMatchObject({ status: "completed" });
  });

  it("finishes a maxTurns run exactly once with failed status", async () => {
    const model: ModelClient = {
      generate: vi.fn(async () => callTool()),
    };
    const agent = new Agent(model, { tools: [tool()], maxTurns: 2 });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await expect(agent.prompt("loop")).rejects.toBeInstanceOf(
      MaxTurnsExceededError,
    );

    const events = trace.getEvents();
    expect(events.filter((event) => event.type === "run_started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run_finished")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: "run_finished",
      status: "failed",
      error: expect.stringContaining("MaxTurnsExceededError"),
    });
  });

  it("uses one run id per prompt and a new id for the next prompt", async () => {
    const model = new SequenceModel([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    const agent = new Agent(model);
    const trace = new TraceCollector();
    trace.subscribe(agent);

    const first = await agent.prompt("one");
    const second = await agent.prompt("two");

    expect(first.run.id).not.toBe(second.run.id);
    const ids = new Set(trace.getEvents().map((event) => event.runId));
    expect(ids).toEqual(new Set([first.run.id, second.run.id]));
    for (const runId of ids) {
      const runEvents = trace
        .getEvents()
        .filter((event) => event.runId === runId);
      expect(runEvents.every((event) => event.runId === runId)).toBe(true);
      expect(runEvents.at(0)?.type).toBe("run_started");
      expect(runEvents.at(-1)?.type).toBe("run_finished");
    }
  });

  it("numbers turns from one in stable order", async () => {
    const model = new SequenceModel([
      callTool(),
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, { tools: [tool()] });
    const trace = new TraceCollector();
    trace.subscribe(agent);

    await agent.prompt("two turns");

    expect(
      trace
        .getEvents()
        .filter((event) => event.type === "turn_started")
        .map((event) => event.turn),
    ).toEqual([1, 2]);
    expect(
      trace
        .getEvents()
        .filter((event) => event.type === "turn_finished")
        .map((event) => event.turn),
    ).toEqual([1, 2]);
  });

  it("TraceCollector stops collecting after unsubscribe", async () => {
    const model = new SequenceModel([
      { role: "assistant", content: "first" },
      { role: "assistant", content: "second" },
    ]);
    const agent = new Agent(model);
    const trace = new TraceCollector();
    const unsubscribe = trace.subscribe(agent);

    await agent.prompt("one");
    const firstRunEventCount = trace.getEvents().length;
    unsubscribe();
    await agent.prompt("two");

    expect(firstRunEventCount).toBeGreaterThan(0);
    expect(trace.getEvents()).toHaveLength(firstRunEventCount);
  });

  it("isolates listener failures from execution and Session persistence", async () => {
    const storedEntries: SessionEntry[] = [];
    const store: SessionStore = {
      load: async () => [],
      append: async (_sessionId, entry) => {
        storedEntries.push(structuredClone(entry));
      },
    };
    const session = await SessionManager.open("listener-errors", store);
    const model = new SequenceModel([{ role: "assistant", content: "done" }]);
    const agent = new Agent(model);
    const listenerOrder: string[] = [];
    agent.subscribe((event) => {
      listenerOrder.push(`failing:${event.type}`);
      throw new Error("observer failed");
    });
    agent.subscribe((event) => {
      listenerOrder.push(`healthy:${event.type}`);
    });

    const result = await new SessionRuntime(agent, session).prompt("hello");

    expect(result.run.status).toBe("completed");
    expect(agent.state.messages).toHaveLength(2);
    expect(session.getMessages()).toEqual(agent.state.messages);
    expect(listenerOrder.slice(0, 2)).toEqual([
      "failing:run_started",
      "healthy:run_started",
    ]);
    expect(agent.getListenerErrors()).toHaveLength(6);
  });
});
