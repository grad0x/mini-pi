export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

export interface ToolResultMessage extends ToolResult {
  role: "tool";
  name: string;
}

// These are Mini Pi messages rather than types from any model provider SDK.
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export interface AgentRunResult {
  finalMessage: AssistantMessage;
  messages: AgentMessage[];
}
