export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolResult {
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

export interface ToolResultMessage {
  role: "tool";
  name: string;
  toolCallId: string;
  content: string;
  isError?: boolean;
}

// These are Mini Pi messages rather than types from any model provider SDK.
export type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage;

export interface AgentRunResult {
  finalMessage: AssistantMessage;
  newMessages: AgentMessage[];
}
