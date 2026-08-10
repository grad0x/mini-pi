import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Agent,
  OpenAICompatibleModelClient,
  OpenAICompatibleProviderError,
  type AgentTool,
  type ModelInput,
} from "../src/index.js";

const apiKey = "unit-test-secret-key";
const emptyInput: ModelInput = {
  systemPrompt: "",
  messages: [],
  tools: [],
};

function providerResponse(message: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function client(options: { timeoutMs?: number } = {}) {
  return new OpenAICompatibleModelClient({
    baseUrl: "https://provider.example/v1/",
    apiKey,
    model: "test-model",
    ...options,
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== "string") {
    throw new Error("Expected a JSON request body");
  }
  return JSON.parse(init.body) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("OpenAICompatibleModelClient", () => {
  it("maps system and user messages into a non-streaming request", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse({ role: "assistant", content: "hello" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().generate({
      ...emptyInput,
      systemPrompt: "Follow the instructions.",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      }),
    );
    expect(requestBody(fetchMock)).toMatchObject({
      model: "test-model",
      stream: false,
      messages: [
        { role: "system", content: "Follow the instructions." },
        { role: "user", content: "Hello" },
      ],
    });
  });

  it("maps tool definitions and enables automatic tool choice", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse({ role: "assistant", content: "done" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const parameters = {
      type: "object" as const,
      properties: { path: { type: "string" as const } },
      required: ["path"],
      additionalProperties: false,
    };

    await client().generate({
      ...emptyInput,
      tools: [{ name: "read_file", description: "Read a file", parameters }],
    });

    expect(requestBody(fetchMock)).toMatchObject({
      tools: [
        {
          type: "function",
          function: { name: "read_file", description: "Read a file", parameters },
        },
      ],
      tool_choice: "auto",
    });
  });

  it("maps assistant tool-call history with JSON arguments", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse({ role: "assistant", content: "done" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().generate({
      ...emptyInput,
      messages: [
        {
          role: "assistant",
          content: "Reading",
          toolCalls: [
            {
              id: "call-1",
              name: "read_file",
              arguments: { path: "calculator.js" },
            },
          ],
        },
      ],
    });

    expect(requestBody(fetchMock).messages).toEqual([
      {
        role: "assistant",
        content: "Reading",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "read_file",
              arguments: '{"path":"calculator.js"}',
            },
          },
        ],
      },
    ]);
  });

  it("maps tool-result history with its tool call id", async () => {
    const fetchMock = vi.fn(async () =>
      providerResponse({ role: "assistant", content: "done" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await client().generate({
      ...emptyInput,
      messages: [
        {
          role: "tool",
          name: "read_file",
          toolCallId: "call-1",
          content: "file contents",
        },
      ],
    });

    expect(requestBody(fetchMock).messages).toEqual([
      { role: "tool", tool_call_id: "call-1", content: "file contents" },
    ]);
  });

  it("maps a plain provider response into an AssistantMessage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        providerResponse({ role: "assistant", content: "Finished." }),
      ),
    );

    await expect(client().generate(emptyInput)).resolves.toEqual({
      role: "assistant",
      content: "Finished.",
    });
  });

  it("maps provider function calls into Mini Pi ToolCalls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        providerResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-2",
              type: "function",
              function: {
                name: "write_file",
                arguments: '{"path":"a.js","content":"fixed"}',
              },
            },
          ],
        }),
      ),
    );

    await expect(client().generate(emptyInput)).resolves.toEqual({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: "call-2",
          name: "write_file",
          arguments: { path: "a.js", content: "fixed" },
        },
      ],
    });
  });

  it("preserves malformed function arguments for Runtime validation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        providerResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-invalid",
              type: "function",
              function: { name: "read_file", arguments: "{invalid json" },
            },
          ],
        }),
      ),
    );

    const message = await client().generate(emptyInput);

    expect(message.toolCalls?.[0]?.arguments).toBe("{invalid json");
  });

  it("lets Runtime turn malformed arguments into a recoverable Tool Result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        providerResponse({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-invalid",
              type: "function",
              function: { name: "read_file", arguments: "{invalid json" },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        providerResponse({ role: "assistant", content: "Recovered." }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const execute = vi.fn<AgentTool["execute"]>(async () => ({
      content: "must not run",
    }));
    const tool: AgentTool = {
      name: "read_file",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      execute,
    };

    const result = await new Agent(client(), { tools: [tool] }).prompt("Read");

    expect(execute).not.toHaveBeenCalled();
    expect(result.newMessages[2]).toMatchObject({
      role: "tool",
      toolCallId: "call-invalid",
      isError: true,
      content: expect.stringContaining("arguments must be an object"),
    });
    expect(result.finalMessage.content).toBe("Recovered.");
    expect(requestBody(fetchMock).messages).toHaveLength(1);
    const secondBody = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ) as { messages: Array<Record<string, unknown>> };
    expect(secondBody.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "call-invalid",
      content: expect.stringContaining("arguments must be an object"),
    });
  });

  it("throws a typed error for an HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
          status: 401,
        }),
      ),
    );

    const promise = client().generate(emptyInput);

    await expect(promise).rejects.toBeInstanceOf(
      OpenAICompatibleProviderError,
    );
    await expect(promise).rejects.toMatchObject({ status: 401 });
    await expect(promise).rejects.toThrow("HTTP 401: Unauthorized");
  });

  it("rejects a response without choices[0].message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [] }))),
    );

    await expect(client().generate(emptyInput)).rejects.toThrow(
      "choices[0].message is missing",
    );
  });

  it("redacts the API key from provider failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`Connection failed with credential ${apiKey}`);
      }),
    );

    const error = await client().generate(emptyInput).catch((value: unknown) =>
      value,
    );

    expect(error).toBeInstanceOf(OpenAICompatibleProviderError);
    expect(String(error)).not.toContain(apiKey);
    expect(String(error)).toContain("[REDACTED]");
    expect((error as Error).cause).toBeUndefined();
  });

  it("aborts a request at the configured timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      ),
    );

    await expect(client({ timeoutMs: 5 }).generate(emptyInput)).rejects.toThrow(
      "timed out after 5 ms",
    );
  });
});
