import type { ToolResult } from "../agent/types.js";

export type ToolParameterType = "string" | "number" | "boolean";

export interface ToolParameterProperty {
  type: ToolParameterType;
  description?: string;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}
