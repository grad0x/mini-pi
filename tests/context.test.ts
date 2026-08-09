import { describe, expect, it, vi } from "vitest";
import {
  Agent,
  DefaultContextCompiler,
  RecentRunsContextCompiler,
  SessionManager,
  SessionRuntime,
  type AgentContext,
  type AgentMessage,
  type AgentTool,
  type AssistantMessage,
  type ContextCompiler,
  type ModelClient,
  type ModelInput,
  type SessionEntry,
  type SessionStore,
} from "../src/index.js";

class SequenceModel implements ModelClient {
  readonly generate = vi.fn<(input: ModelInput) => Promise<AssistantMessage>>();

  constructor(responses: AssistantMessage[]) {
    for (const response of responses) {
      this.generate.mockResolvedValueOnce(response);
    }
  }
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

const mockTool: AgentTool = {
  name: "mock_tool",
  description: "Returns a mock result",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async () => ({ content: "tool-result" }),
};

function messages(...labels: string[]): AgentMessage[] {
  return labels.map<AgentMessage>((label, index) =>
    index % 2 === 0
      ? { role: "user", content: label }
      : { role: "assistant", content: label },
  );
}

describe("DefaultContextCompiler", () => {
  it("preserves all messages and projects complete tool definitions", async () => {
    const history = messages("User 1", "Assistant 1");
    const model = new SequenceModel([
      { role: "assistant", content: "Assistant 2" },
    ]);
    const agent = new Agent(model, {
      initialMessages: history,
      tools: [mockTool],
    });

    await agent.prompt("User 2");

    expect(model.generate.mock.calls[0]?.[0]).toEqual({
      systemPrompt: "",
      messages: [...history, { role: "user", content: "User 2" }],
      tools: [
        {
          name: "mock_tool",
          description: "Returns a mock result",
          parameters: mockTool.parameters,
        },
      ],
    });
  });

  it("passes the Agent system prompt to ModelInput", async () => {
    const model = new SequenceModel([{ role: "assistant", content: "done" }]);
    const agent = new Agent(model, { systemPrompt: "You are Mini Pi." });

    await agent.prompt("hello");

    expect(model.generate.mock.calls[0]?.[0].systemPrompt).toBe(
      "You are Mini Pi.",
    );
    expect(agent.state.systemPrompt).toBe("You are Mini Pi.");
  });
});

describe("AgentContext snapshots", () => {
  it("copies the state message and tool arrays before compilation", async () => {
    let captured: AgentContext | undefined;
    const defaultCompiler = new DefaultContextCompiler();
    const compiler: ContextCompiler = {
      compile(context) {
        captured = context;
        return defaultCompiler.compile(context);
      },
    };
    const model = new SequenceModel([{ role: "assistant", content: "done" }]);
    const agent = new Agent(model, {
      tools: [mockTool],
      contextCompiler: compiler,
    });

    await agent.prompt("hello");

    expect(captured).toBeDefined();
    expect(captured?.messages).not.toBe(agent.state.messages);
    expect(captured?.tools).not.toBe(agent.state.tools);
    expect(captured?.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("snapshots and compiles again before every model call", async () => {
    const contexts: AgentContext[] = [];
    const defaultCompiler = new DefaultContextCompiler();
    const compiler: ContextCompiler = {
      compile: vi.fn((context: AgentContext) => {
        contexts.push(context);
        return defaultCompiler.compile(context);
      }),
    };
    const model = new SequenceModel([
      {
        role: "assistant",
        content: "calling tool",
        toolCalls: [
          { id: "call-1", name: "mock_tool", arguments: {} },
        ],
      },
      { role: "assistant", content: "done" },
    ]);
    const agent = new Agent(model, {
      tools: [mockTool],
      contextCompiler: compiler,
    });

    await agent.prompt("use tool");

    expect(compiler.compile).toHaveBeenCalledTimes(2);
    expect(contexts[0]?.messages.map((message) => message.role)).toEqual([
      "user",
    ]);
    expect(contexts[1]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
    ]);
  });
});

describe("RecentRunsContextCompiler", () => {
  it("projects only the most recent complete run segments", () => {
    const compiler = new RecentRunsContextCompiler({ maxRuns: 2 });
    const transcript = messages(
      "User 1",
      "Assistant 1",
      "User 2",
      "Assistant 2",
      "User 3",
      "Assistant 3",
    );

    const result = compiler.compile({
      systemPrompt: "system",
      messages: transcript,
      tools: [],
    });

    expect(result.messages).toEqual(transcript.slice(2));
    expect(result.systemPrompt).toBe("system");
    expect(transcript).toHaveLength(6);
  });

  it("does not prune the full AgentState transcript", async () => {
    const history = messages(
      "User 1",
      "Assistant 1",
      "User 2",
      "Assistant 2",
    );
    const model = new SequenceModel([
      { role: "assistant", content: "Assistant 3" },
    ]);
    const agent = new Agent(model, {
      initialMessages: history,
      contextCompiler: new RecentRunsContextCompiler({ maxRuns: 2 }),
    });

    await agent.prompt("User 3");

    expect(model.generate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "User 2" },
      { role: "assistant", content: "Assistant 2" },
      { role: "user", content: "User 3" },
    ]);
    expect(agent.state.messages).toEqual([
      ...history,
      { role: "user", content: "User 3" },
      { role: "assistant", content: "Assistant 3" },
    ]);
  });

  it("keeps Session history complete while projecting model context", async () => {
    const store = new MemorySessionStore();
    const session = await SessionManager.open("context-session", store);
    const model = new SequenceModel([
      { role: "assistant", content: "Assistant 1" },
      { role: "assistant", content: "Assistant 2" },
      { role: "assistant", content: "Assistant 3" },
    ]);
    const agent = new Agent(model, {
      contextCompiler: new RecentRunsContextCompiler({ maxRuns: 2 }),
    });
    const runtime = new SessionRuntime(agent, session);

    await runtime.prompt("User 1");
    await runtime.prompt("User 2");
    await runtime.prompt("User 3");

    expect(model.generate.mock.calls[2]?.[0].messages).toEqual([
      { role: "user", content: "User 2" },
      { role: "assistant", content: "Assistant 2" },
      { role: "user", content: "User 3" },
    ]);
    expect(session.getMessages()).toEqual(messages(
      "User 1",
      "Assistant 1",
      "User 2",
      "Assistant 2",
      "User 3",
      "Assistant 3",
    ));
  });

  it("keeps every message in a selected tool trajectory", () => {
    const compiler = new RecentRunsContextCompiler({ maxRuns: 2 });
    const oldRun = messages("Old user", "Old assistant");
    const toolRun: AgentMessage[] = [
      { role: "user", content: "Tool user" },
      {
        role: "assistant",
        content: "Calling tool",
        toolCalls: [
          { id: "call-1", name: "mock_tool", arguments: {} },
        ],
      },
      {
        role: "tool",
        name: "mock_tool",
        toolCallId: "call-1",
        content: "tool-result",
      },
      { role: "assistant", content: "Tool done" },
    ];
    const newestRun = messages("Newest user", "Newest assistant");

    const result = compiler.compile({
      systemPrompt: "",
      messages: [...oldRun, ...toolRun, ...newestRun],
      tools: [mockTool],
    });

    expect(result.messages).toEqual([...toolRun, ...newestRun]);
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it.each([0, -1, 1.5])("rejects invalid maxRuns %s", (maxRuns) => {
    expect(() => new RecentRunsContextCompiler({ maxRuns })).toThrow(
      "maxRuns must be a positive integer",
    );
  });
});
