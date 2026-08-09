import type { ToolCall, ToolResult } from "../agent/types.js";
import type { AgentContext } from "../context/context.js";

export interface BeforeToolCallContext {
  readonly runId: string;
  readonly turn: number;
  readonly toolCall: Readonly<ToolCall>;
  readonly args: Readonly<Record<string, unknown>>;
  readonly context: AgentContext;
}

export interface BeforeToolCallResult {
  readonly block?: boolean;
  readonly reason?: string;
}

export interface AfterToolCallContext {
  readonly runId: string;
  readonly turn: number;
  readonly toolCall: Readonly<ToolCall>;
  readonly args: Readonly<Record<string, unknown>>;
  readonly result: Readonly<ToolResult>;
  readonly isError: boolean;
  readonly context: AgentContext;
}

export interface AfterToolCallResult {
  readonly content?: string;
  readonly isError?: boolean;
}

export interface AgentHook {
  beforeToolCall?(
    context: BeforeToolCallContext,
  ):
    | BeforeToolCallResult
    | undefined
    | Promise<BeforeToolCallResult | undefined>;

  afterToolCall?(
    context: AfterToolCallContext,
  ):
    | AfterToolCallResult
    | undefined
    | Promise<AfterToolCallResult | undefined>;
}
