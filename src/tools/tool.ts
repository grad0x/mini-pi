import type { ToolResult } from "../agent/types.js";

export interface AgentTool {
  name: string;
  description: string;
  execute(
    toolCallId: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult>;
}
