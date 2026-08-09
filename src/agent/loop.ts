import type { ModelClient } from "../providers/model-client.js";
import {
  DefaultContextCompiler,
  type ContextCompiler,
} from "../context/compiler.js";
import { createAgentContextSnapshot } from "../context/snapshot.js";
import type { AgentEventSink } from "../events/event.js";
import type {
  AfterToolCallResult,
  AgentHook,
  BeforeToolCallContext,
} from "../hooks/hook.js";
import { validateToolArguments } from "../tools/validate-arguments.js";
import type { AgentState } from "./state.js";
import type {
  AssistantMessage,
  ToolCall,
  ToolResult,
  ToolResultMessage,
} from "./types.js";

export interface AgentLoopOptions {
  maxTurns?: number;
  contextCompiler?: ContextCompiler;
  runId?: string;
  emit?: AgentEventSink;
  hooks?: readonly AgentHook[];
}

export class MaxTurnsExceededError extends Error {
  constructor(maxTurns: number) {
    super(`Agent loop exceeded the maximum of ${maxTurns} model turns`);
    this.name = "MaxTurnsExceededError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ToolCallExecution {
  message: ToolResultMessage;
  blocked: boolean;
}

function toolResultMessage(
  call: ToolCall,
  result: { content: string; isError?: boolean },
): ToolResultMessage {
  return {
    role: "tool",
    name: call.name,
    toolCallId: call.id,
    content: result.content,
    ...(result.isError === undefined ? {} : { isError: result.isError }),
  };
}

async function executeToolCall(
  state: AgentState,
  call: ToolCall,
  hooks: readonly AgentHook[],
  runId: string,
  turn: number,
): Promise<ToolCallExecution> {
  const tool = state.tools.find((candidate) => candidate.name === call.name);

  if (!tool) {
    return {
      message: toolResultMessage(call, {
        content: `Unknown tool: ${call.name}`,
        isError: true,
      }),
      blocked: false,
    };
  }

  const validation = validateToolArguments(tool.parameters, call.arguments);
  if (!validation.valid) {
    return {
      message: toolResultMessage(call, {
        content: `Invalid arguments for ${call.name}: ${validation.error}`,
        isError: true,
      }),
      blocked: false,
    };
  }

  const args = Object.freeze({ ...validation.args });
  const toolCall = Object.freeze({ ...call });
  const context = createAgentContextSnapshot(state);
  const beforeContext: BeforeToolCallContext = Object.freeze({
    runId,
    turn,
    toolCall,
    args,
    context,
  });

  for (const hook of hooks) {
    if (!hook.beforeToolCall) {
      continue;
    }
    let decision;
    try {
      decision = await hook.beforeToolCall(beforeContext);
    } catch (error) {
      return {
        message: toolResultMessage(call, {
          content: `beforeToolCall failed: ${errorMessage(error)}`,
          isError: true,
        }),
        blocked: true,
      };
    }
    if (decision?.block === true) {
      return {
        message: toolResultMessage(call, {
          content: decision.reason
            ? `Tool execution blocked: ${decision.reason}`
            : "Tool execution was blocked",
          isError: true,
        }),
        blocked: true,
      };
    }
  }

  let result: ToolResult;
  try {
    result = await tool.execute(args);
  } catch (error) {
    result = {
      content: `Tool execution failed: ${errorMessage(error)}`,
      isError: true,
    };
  }

  for (const hook of hooks) {
    if (!hook.afterToolCall) {
      continue;
    }
    let update: AfterToolCallResult | undefined;
    try {
      update = await hook.afterToolCall(
        Object.freeze({
          runId,
          turn,
          toolCall,
          args,
          result: Object.freeze({ ...result }),
          isError: result.isError === true,
          context,
        }),
      );
    } catch (error) {
      result = {
        content: `afterToolCall failed: ${errorMessage(error)}`,
        isError: true,
      };
      break;
    }
    if (update) {
      const isError = update.isError ?? result.isError;
      result = {
        content: update.content ?? result.content,
        ...(isError === undefined ? {} : { isError }),
      };
    }
  }

  return { message: toolResultMessage(call, result), blocked: false };
}

/** Runs model and tool turns until the model returns a final text response. */
export async function runAgentLoop(
  state: AgentState,
  model: ModelClient,
  options: AgentLoopOptions = {},
): Promise<AssistantMessage> {
  const maxTurns = options.maxTurns ?? 10;
  const contextCompiler =
    options.contextCompiler ?? new DefaultContextCompiler();
  const emit = options.emit ?? (async () => undefined);
  const runId = options.runId ?? "standalone";
  const hooks = options.hooks ?? [];

  if (options.emit && !options.runId) {
    throw new Error("runId is required when an event sink is provided");
  }

  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new RangeError("maxTurns must be a positive integer");
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const turnNumber = turn + 1;
    let toolCallCount = 0;
    let hasError = false;
    let turnFinished = false;

    await emit({
      type: "turn_started",
      runId,
      turn: turnNumber,
      timestamp: Date.now(),
    });

    try {
      const context = createAgentContextSnapshot(state);
      const modelInput = await contextCompiler.compile(context);
      await emit({
        type: "model_call_started",
        runId,
        turn: turnNumber,
        timestamp: Date.now(),
      });

      let assistantMessage: AssistantMessage;
      try {
        assistantMessage = await model.generate(modelInput);
      } catch (error) {
        hasError = true;
        await emit({
          type: "model_call_finished",
          runId,
          turn: turnNumber,
          isError: true,
          hasToolCalls: false,
          toolCallCount: 0,
          timestamp: Date.now(),
        });
        throw error;
      }

      const toolCalls = assistantMessage.toolCalls ?? [];
      toolCallCount = toolCalls.length;
      await emit({
        type: "model_call_finished",
        runId,
        turn: turnNumber,
        isError: false,
        hasToolCalls: toolCallCount > 0,
        toolCallCount,
        timestamp: Date.now(),
      });
      state.messages.push(assistantMessage);

      for (const call of toolCalls) {
        await emit({
          type: "tool_call_started",
          runId,
          turn: turnNumber,
          toolCallId: call.id,
          toolName: call.name,
          timestamp: Date.now(),
        });
        const execution = await executeToolCall(
          state,
          call,
          hooks,
          runId,
          turnNumber,
        );
        state.messages.push(execution.message);
        const isError = execution.message.isError === true;
        hasError ||= isError;
        await emit({
          type: "tool_call_finished",
          runId,
          turn: turnNumber,
          toolCallId: call.id,
          toolName: call.name,
          isError,
          blocked: execution.blocked,
          timestamp: Date.now(),
        });
      }

      await emit({
        type: "turn_finished",
        runId,
        turn: turnNumber,
        toolCallCount,
        hasError,
        timestamp: Date.now(),
      });
      turnFinished = true;

      if (toolCalls.length === 0) {
        return assistantMessage;
      }
    } catch (error) {
      if (!turnFinished) {
        await emit({
          type: "turn_finished",
          runId,
          turn: turnNumber,
          toolCallCount,
          hasError: true,
          timestamp: Date.now(),
        });
      }
      throw error;
    }
  }

  throw new MaxTurnsExceededError(maxTurns);
}
