import type { AgentMessage, AssistantMessage } from "../agent/types.js";
import type { ToolParameterSchema } from "../tools/tool.js";

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

export interface ModelInput {
  systemPrompt: string;
  messages: readonly AgentMessage[];
  tools: readonly ModelToolDefinition[];
}

// Provider adapters implement this boundary; the Agent Core stays vendor-neutral.
export interface ModelClient {
  generate(input: ModelInput): Promise<AssistantMessage>;
}
