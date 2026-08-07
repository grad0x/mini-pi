import type { AgentMessage, AssistantMessage } from "../agent/types.js";

export interface ModelToolDefinition {
  name: string;
  description: string;
}

export interface ModelInput {
  messages: readonly AgentMessage[];
  tools: readonly ModelToolDefinition[];
}

// Provider adapters implement this boundary; the Agent Core stays vendor-neutral.
export interface ModelClient {
  generate(input: ModelInput): Promise<AssistantMessage>;
}
