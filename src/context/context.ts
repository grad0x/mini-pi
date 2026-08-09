import type { AgentMessage } from "../agent/types.js";
import type { AgentTool } from "../tools/tool.js";

/** Stable top-level runtime view captured for one model call. */
export interface AgentContext {
  readonly systemPrompt: string;
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentTool[];
}
