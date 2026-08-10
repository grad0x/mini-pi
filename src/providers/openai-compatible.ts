import type {
  AgentMessage,
  AssistantMessage,
  ToolCall,
} from "../agent/types.js";
import type {
  ModelClient,
  ModelInput,
  ModelToolDefinition,
} from "./model-client.js";

export interface OpenAICompatibleModelClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

interface OpenAICompatibleProviderErrorOptions {
  status?: number;
}

export class OpenAICompatibleProviderError extends Error {
  readonly status: number | undefined;

  constructor(
    message: string,
    options: OpenAICompatibleProviderErrorOptions = {},
  ) {
    super(message);
    this.name = "OpenAICompatibleProviderError";
    this.status = options.status;
  }
}

interface OpenAICompatibleFunctionTool {
  type: "function";
  function: ModelToolDefinition;
}

interface OpenAICompatibleToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

type OpenAICompatibleMessage =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: OpenAICompatibleToolCall[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

interface OpenAICompatibleRequest {
  model: string;
  messages: OpenAICompatibleMessage[];
  stream: false;
  tools?: OpenAICompatibleFunctionTool[];
  tool_choice?: "auto";
}

function requireNonEmpty(value: string, name: string): string {
  if (value.trim() === "") {
    throw new TypeError(`${name} must not be empty`);
  }
  return value;
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function serializeToolArguments(argumentsValue: unknown): string {
  try {
    return JSON.stringify(argumentsValue) ?? "null";
  } catch {
    throw new OpenAICompatibleProviderError(
      "Could not serialize tool call arguments",
    );
  }
}

function mapMessage(message: AgentMessage): OpenAICompatibleMessage {
  if (message.role === "user") {
    return { role: "user", content: message.content };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  const toolCalls = message.toolCalls?.map((call) => ({
    id: call.id,
    type: "function" as const,
    function: {
      name: call.name,
      arguments: serializeToolArguments(call.arguments),
    },
  }));
  return {
    role: "assistant",
    content: message.content,
    ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function mapRequest(input: ModelInput, model: string): OpenAICompatibleRequest {
  const messages: OpenAICompatibleMessage[] = [
    ...(input.systemPrompt === ""
      ? []
      : [{ role: "system" as const, content: input.systemPrompt }]),
    ...input.messages.map(mapMessage),
  ];
  const tools = input.tools.map((tool) => ({
    type: "function" as const,
    function: tool,
  }));
  return {
    model,
    messages,
    stream: false,
    ...(tools.length > 0 ? { tools, tool_choice: "auto" as const } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformedResponse(detail: string): OpenAICompatibleProviderError {
  return new OpenAICompatibleProviderError(
    `Malformed OpenAI-compatible API response: ${detail}`,
  );
}

function parseToolArguments(rawArguments: string): unknown {
  try {
    return JSON.parse(rawArguments) as unknown;
  } catch {
    return rawArguments;
  }
}

function mapToolCall(value: unknown, index: number): ToolCall {
  if (!isRecord(value)) {
    throw malformedResponse(`tool_calls[${index}] must be an object`);
  }
  const functionValue = value.function;
  if (
    typeof value.id !== "string" ||
    value.type !== "function" ||
    !isRecord(functionValue) ||
    typeof functionValue.name !== "string" ||
    typeof functionValue.arguments !== "string"
  ) {
    throw malformedResponse(`tool_calls[${index}] is incomplete`);
  }
  return {
    id: value.id,
    name: functionValue.name,
    arguments: parseToolArguments(functionValue.arguments),
  };
}

function mapResponse(payload: unknown): AssistantMessage {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw malformedResponse("choices is missing");
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw malformedResponse("choices[0].message is missing");
  }
  const message = firstChoice.message;
  if (message.role !== "assistant") {
    throw malformedResponse("message.role must be assistant");
  }
  if (message.content !== null && typeof message.content !== "string") {
    throw malformedResponse("message.content must be a string or null");
  }
  if (
    message.tool_calls !== undefined &&
    !Array.isArray(message.tool_calls)
  ) {
    throw malformedResponse("message.tool_calls must be an array");
  }

  const toolCalls = (message.tool_calls ?? []).map(mapToolCall);
  return {
    role: "assistant",
    content: message.content ?? "",
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
}

function secretSafe(value: unknown, apiKey: string): string {
  const detail = value instanceof Error ? value.message : String(value);
  return detail.split(apiKey).join("[REDACTED]");
}

function providerErrorDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return typeof payload.message === "string" ? payload.message : undefined;
}

export class OpenAICompatibleModelClient implements ModelClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleModelClientOptions) {
    this.baseUrl = requireNonEmpty(options.baseUrl, "baseUrl");
    this.apiKey = requireNonEmpty(options.apiKey, "apiKey");
    this.model = requireNonEmpty(options.model, "model");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new RangeError("timeoutMs must be a positive integer");
    }
  }

  async generate(input: ModelInput): Promise<AssistantMessage> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let responseText: string;

    try {
      try {
        response = await fetch(buildChatCompletionsUrl(this.baseUrl), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(mapRequest(input, this.model)),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new OpenAICompatibleProviderError(
            `OpenAI-compatible request timed out after ${this.timeoutMs} ms`,
          );
        }
        throw new OpenAICompatibleProviderError(
          `OpenAI-compatible request failed: ${secretSafe(error, this.apiKey)}`,
        );
      }

      try {
        responseText = await response.text();
      } catch (error) {
        if (controller.signal.aborted) {
          throw new OpenAICompatibleProviderError(
            `OpenAI-compatible request timed out after ${this.timeoutMs} ms`,
            { status: response.status },
          );
        }
        throw new OpenAICompatibleProviderError(
          `Could not read OpenAI-compatible response: ${secretSafe(error, this.apiKey)}`,
          { status: response.status },
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      if (!response.ok) {
        throw new OpenAICompatibleProviderError(
          `OpenAI-compatible API returned HTTP ${response.status}`,
          { status: response.status },
        );
      }
      throw new OpenAICompatibleProviderError(
        "Malformed OpenAI-compatible API response: response is not valid JSON",
        { status: response.status },
      );
    }

    if (!response.ok) {
      const detail = providerErrorDetail(payload);
      throw new OpenAICompatibleProviderError(
        `OpenAI-compatible API returned HTTP ${response.status}${
          detail ? `: ${secretSafe(detail, this.apiKey)}` : ""
        }`,
        { status: response.status },
      );
    }

    return mapResponse(payload);
  }
}
