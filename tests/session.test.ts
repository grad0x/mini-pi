import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Agent,
  JsonlSessionStore,
  MaxTurnsExceededError,
  SessionConsistencyError,
  SessionManager,
  SessionRuntime,
  type AgentMessage,
  type AgentTool,
  type AssistantMessage,
  type MessageSessionEntry,
  type ModelClient,
  type ModelInput,
  type SessionStore,
} from "../src/index.js";

const temporaryRoots: string[] = [];

async function createStore(): Promise<{
  root: string;
  store: JsonlSessionStore;
}> {
  const root = await mkdtemp(join(tmpdir(), "mini-pi-session-"));
  temporaryRoots.push(root);
  return {
    root,
    store: new JsonlSessionStore({ rootDir: join(root, "sessions") }),
  };
}

function entry(
  id: string,
  parentId: string | null,
  message: AgentMessage,
): MessageSessionEntry {
  return { id, parentId, timestamp: 1, type: "message", message };
}

class SequenceModel implements ModelClient {
  readonly generate = vi.fn<(input: ModelInput) => Promise<AssistantMessage>>();

  constructor(responses: AssistantMessage[]) {
    for (const response of responses) {
      this.generate.mockResolvedValueOnce(response);
    }
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

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("JsonlSessionStore", () => {
  it("treats missing and empty session files as new sessions", async () => {
    const { root, store } = await createStore();
    expect(await store.load("missing")).toEqual([]);

    await mkdir(join(root, "sessions"));
    await writeFile(join(root, "sessions", "empty.jsonl"), "", "utf8");
    expect(await store.load("empty")).toEqual([]);
  });

  it("appends one JSON entry per line and loads both entries", async () => {
    const { root, store } = await createStore();
    const first = entry("e1", null, { role: "user", content: "hello" });
    const second = entry("e2", "e1", {
      role: "assistant",
      content: "hi",
    });

    await store.append("append-test", first);
    await store.append("append-test", second);

    const content = await readFile(
      join(root, "sessions", "append-test.jsonl"),
      "utf8",
    );
    expect(content.trimEnd().split("\n")).toHaveLength(2);
    expect(await store.load("append-test")).toEqual([first, second]);
  });

  it("reports the session id and line number for malformed JSONL", async () => {
    const { root, store } = await createStore();
    await mkdir(join(root, "sessions"));
    await writeFile(
      join(root, "sessions", "broken.jsonl"),
      `${JSON.stringify(entry("e1", null, { role: "user", content: "ok" }))}\n{broken-json}\n`,
      "utf8",
    );

    await expect(store.load("broken")).rejects.toThrow(
      /session "broken" at line 2/,
    );
  });

  it("rejects traversal in session ids", async () => {
    const { store } = await createStore();
    const first = entry("e1", null, { role: "user", content: "hello" });

    await expect(store.load("../../outside")).rejects.toThrow(
      /Invalid session id/,
    );
    await expect(store.append("../../outside", first)).rejects.toThrow(
      /Invalid session id/,
    );
  });
});

describe("SessionManager", () => {
  it("maintains a linear parent chain", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("parent-chain", store);

    const first = await session.appendMessage({ role: "user", content: "A" });
    const second = await session.appendMessage({
      role: "assistant",
      content: "B",
    });
    const third = await session.appendMessage({ role: "user", content: "C" });

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
    expect(third.parentId).toBe(second.id);
  });

  it("serializes concurrent appends onto one parent chain", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("concurrent-chain", store);

    const [first, second] = await Promise.all([
      session.appendMessage({ role: "user", content: "A" }),
      session.appendMessage({ role: "assistant", content: "B" }),
    ]);

    expect(first.parentId).toBeNull();
    expect(second.parentId).toBe(first.id);
    await expect(
      SessionManager.open("concurrent-chain", store),
    ).resolves.toBeInstanceOf(SessionManager);
  });

  it("does not advance in-memory history when persistence fails", async () => {
    const failingStore: SessionStore = {
      load: async () => [],
      append: async () => {
        throw new Error("disk unavailable");
      },
    };
    const session = await SessionManager.open("append-failure", failingStore);

    await expect(
      session.appendMessage({ role: "user", content: "not persisted" }),
    ).rejects.toThrow("disk unavailable");
    expect(session.getEntries()).toEqual([]);
  });

  it("rejects an invalid parent chain during restore", async () => {
    const { store } = await createStore();
    await store.append(
      "invalid-chain",
      entry("e1", null, { role: "user", content: "A" }),
    );
    await store.append(
      "invalid-chain",
      entry("e2", "unknown", { role: "assistant", content: "B" }),
    );

    await expect(
      SessionManager.open("invalid-chain", store),
    ).rejects.toBeInstanceOf(SessionConsistencyError);
  });
});

describe("SessionRuntime", () => {
  it("restores persisted messages into a new Agent instance", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("restore", store);
    const runtime = new SessionRuntime(
      new Agent(
        new SequenceModel([{ role: "assistant", content: "Assistant A" }]),
      ),
      session,
    );
    await runtime.prompt("User A");

    const restored = await SessionManager.open("restore", store);
    const initialMessages = restored.getMessages();
    const agent = new Agent(
      new SequenceModel([{ role: "assistant", content: "unused" }]),
      { initialMessages },
    );
    initialMessages.length = 0;

    expect(agent.state.messages).toEqual([
      { role: "user", content: "User A" },
      { role: "assistant", content: "Assistant A" },
    ]);
  });

  it("continues a conversation after restore", async () => {
    const { store } = await createStore();
    const firstSession = await SessionManager.open("continue", store);
    await new SessionRuntime(
      new Agent(
        new SequenceModel([{ role: "assistant", content: "Assistant A" }]),
      ),
      firstSession,
    ).prompt("User A");

    const restored = await SessionManager.open("continue", store);
    const model = new SequenceModel([
      { role: "assistant", content: "Assistant B" },
    ]);
    const agent = new Agent(model, { initialMessages: restored.getMessages() });
    await new SessionRuntime(agent, restored).prompt("User B");

    expect(model.generate.mock.calls[0]?.[0].messages).toEqual([
      { role: "user", content: "User A" },
      { role: "assistant", content: "Assistant A" },
      { role: "user", content: "User B" },
    ]);
    expect(
      (await SessionManager.open("continue", store)).getMessages(),
    ).toEqual([
      { role: "user", content: "User A" },
      { role: "assistant", content: "Assistant A" },
      { role: "user", content: "User B" },
      { role: "assistant", content: "Assistant B" },
    ]);
  });

  it("persists a complete tool trajectory as message entries", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("tools", store);
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
    await new SessionRuntime(
      new Agent(model, { tools: [mockTool] }),
      session,
    ).prompt("use a tool");

    const restored = await SessionManager.open("tools", store);
    expect(restored.getEntries().every((item) => item.type === "message")).toBe(
      true,
    );
    expect(restored.getMessages().map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("does not duplicate messages across multiple prompts", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("multiple", store);
    const model = new SequenceModel([
      { role: "assistant", content: "Assistant A" },
      { role: "assistant", content: "Assistant B" },
    ]);
    const runtime = new SessionRuntime(new Agent(model), session);

    await runtime.prompt("User A");
    await runtime.prompt("User B");

    expect(session.getMessages()).toEqual([
      { role: "user", content: "User A" },
      { role: "assistant", content: "Assistant A" },
      { role: "user", content: "User B" },
      { role: "assistant", content: "Assistant B" },
    ]);
  });

  it("persists the trajectory produced by a failed run", async () => {
    const { store } = await createStore();
    const session = await SessionManager.open("failed", store);
    const toolCall: AssistantMessage = {
      role: "assistant",
      content: "again",
      toolCalls: [{ id: "loop", name: "mock_tool", arguments: {} }],
    };
    const model: ModelClient = { generate: vi.fn(async () => toolCall) };
    const agent = new Agent(model, { tools: [mockTool], maxTurns: 2 });
    const runtime = new SessionRuntime(agent, session);

    await expect(runtime.prompt("keep going")).rejects.toBeInstanceOf(
      MaxTurnsExceededError,
    );

    const restored = await SessionManager.open("failed", store);
    expect(restored.getMessages()).toEqual(agent.state.messages);
    expect(restored.getMessages().map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
  });
});
