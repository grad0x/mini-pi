import type { AgentMessage } from "./types.js";
import type { AgentTool } from "../tools/tool.js";

export type AgentStatus = "idle" | "running" | "error";

export interface AgentState {
  messages: AgentMessage[];
  tools: AgentTool[];
  status: AgentStatus;
}
