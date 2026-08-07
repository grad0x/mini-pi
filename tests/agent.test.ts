import { describe, expect, it, vi } from "vitest";
import {
  Agent,
  MaxTurnsExceededError,
  type AgentTool,
  type AssistantMessage,
  type ModelClient,
  type ModelInput,
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
  execute: AgentTool["execute"] = async () => ({ content: "tool-result" }),
): AgentTool {
  return {
    name: "mock_tool",
    description: "Returns a mock result",
    parameters: {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    },
    execute,
  };
}

const callTool: AssistantMessage = {
  role: "assistant",
  content: "Calling mock_tool",
  toolCalls: [{ id: "call-1", name: "mock_tool", arguments: { value: 1 } }],
};

describe("Agent", () => {
  it("finishes after a plain text model response", async () => {
    const model = new SequenceModel([
      { role: "assistant", content: "hello" },
    ]);
    const agent = new Agent(model);

    const result = await agent.prompt("hi");

    expect(result.finalMessage.content).toBe("hello");
    expect(result.newMessages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    expect(agent.state.status).toBe("idle");
  });

  it("returns only the messages created by each prompt", async () => {
    const model = new SequenceModel([
      { role: "assistant", content: "first answer" },
      { role: "assistant", content: "second answer" },
    ]);
    const agent = new Agent(model);

    const first = await agent.prompt("first");
    const second = await agent.prompt("second");

    expect(first.newMessages).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "first answer" },
    ]);
    expect(second.newMessages).toEqual([
      { role: "user", content: "second" },
      { role: "assistant", content: "second answer" },
    ]);
    expect(agent.state.messages).toEqual([
      ...first.newMessages,
      ...second.newMessages,
    ]);
    expect(model.generate.mock.calls[1]?.[0].messages).toEqual([
      ...first.newMessages,
      { role: "user", content: "second" },
    ]);
  });

  it("owns toolCallId correlation and sends the tool result to the model", async () => {
    const model = new SequenceModel([
      callTool,
      { role: "assistant", content: "done: tool-result" },
    ]);
    const mockTool = tool(vi.fn(tool().execute));
    const agent = new Agent(model, { tools: [mockTool] });

    const result = await agent.prompt("calculate something");

    expect(mockTool.execute).toHaveBeenCalledWith({ value: 1 });
    expect(model.generate).toHaveBeenCalledTimes(2);
    expect(result.newMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.newMessages[2]).toEqual({
      role: "tool",
      name: "mock_tool",
      toolCallId: "call-1",
      content: "tool-result",
    });
    expect(result.finalMessage.content).toBe("done: tool-result");

    const secondInput = model.generate.mock.calls[1]?.[0];
    expect(secondInput?.messages.at(-1)).toEqual(result.newMessages[2]);
    expect(secondInput?.tools).toEqual([
      {
        name: "mock_tool",
        description: "Returns a mock result",
        parameters: {
          type: "object",
          properties: { value: { type: "number" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ]);
  });

  it("records an error result when the model requests an unknown tool", async () => {
    const model = new SequenceModel([
      {
        role: "assistant",
        content: "Calling an unknown tool",
        toolCalls: [
          { id: "unknown-1", name: "unknown_tool", arguments: {} },
        ],
      },
      { role: "assistant", content: "recovered" },
    ]);
    const agent = new Agent(model);

    const result = await agent.prompt("try it");

    expect(result.newMessages[2]).toEqual({
      role: "tool",
      name: "unknown_tool",
      toolCallId: "unknown-1",
      content: "Unknown tool: unknown_tool",
      isError: true,
    });
    expect(result.finalMessage.content).toBe("recovered");
  });

  it("converts a thrown tool error into a tool result", async () => {
    const model = new SequenceModel([
      callTool,
      { role: "assistant", content: "handled failure" },
    ]);
    const failingTool = tool(async () => {
      throw new Error("mock failure");
    });
    const agent = new Agent(model, { tools: [failingTool] });

    const result = await agent.prompt("fail safely");

    expect(result.newMessages[2]).toEqual({
      role: "tool",
      name: "mock_tool",
      toolCallId: "call-1",
      content: "Tool execution failed: mock failure",
      isError: true,
    });
    expect(result.finalMessage.content).toBe("handled failure");
  });

  it("rejects invalid tool arguments before executing the tool", async () => {
    const model = new SequenceModel([
      {
        ...callTool,
        toolCalls: [
          { id: "call-invalid", name: "mock_tool", arguments: { value: "1" } },
        ],
      },
      { role: "assistant", content: "invalid arguments handled" },
    ]);
    const execute = vi.fn(tool().execute);
    const agent = new Agent(model, { tools: [tool(execute)] });

    const result = await agent.prompt("use invalid arguments");

    expect(execute).not.toHaveBeenCalled();
    expect(result.newMessages[2]).toEqual({
      role: "tool",
      name: "mock_tool",
      toolCallId: "call-invalid",
      content: "Invalid arguments for mock_tool: argument value must be a number",
      isError: true,
    });
  });

  it("stops a model that keeps requesting tools at maxTurns", async () => {
    const model: ModelClient = {
      generate: vi.fn(async () => callTool),
    };
    const agent = new Agent(model, { tools: [tool()], maxTurns: 3 });

    await expect(agent.prompt("loop forever")).rejects.toBeInstanceOf(
      MaxTurnsExceededError,
    );
    expect(model.generate).toHaveBeenCalledTimes(3);
    expect(agent.state.messages).toHaveLength(7);
    expect(agent.state.status).toBe("error");
  });
});
