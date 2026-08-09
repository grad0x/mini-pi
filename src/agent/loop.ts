import type { ModelClient } from "../providers/model-client.js";
import {
  DefaultContextCompiler,
  type ContextCompiler,
} from "../context/compiler.js";
import { createAgentContextSnapshot } from "../context/snapshot.js";
import { validateToolArguments } from "../tools/validate-arguments.js";
import type { AgentState } from "./state.js";
import type {
  AssistantMessage,
  ToolCall,
  ToolResultMessage,
} from "./types.js";

export interface AgentLoopOptions {
  maxTurns?: number;
  contextCompiler?: ContextCompiler;
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

async function executeToolCall(
  state: AgentState,
  call: ToolCall,
): Promise<ToolResultMessage> {
  const tool = state.tools.find((candidate) => candidate.name === call.name);

  if (!tool) {
    return {
      role: "tool",
      name: call.name,
      toolCallId: call.id,
      content: `Unknown tool: ${call.name}`,
      isError: true,
    };
  }

  const validation = validateToolArguments(tool.parameters, call.arguments);
  if (!validation.valid) {
    return {
      role: "tool",
      name: call.name,
      toolCallId: call.id,
      content: `Invalid arguments for ${call.name}: ${validation.error}`,
      isError: true,
    };
  }

  try {
    const result = await tool.execute(validation.args);
    return {
      role: "tool",
      name: call.name,
      toolCallId: call.id,
      content: result.content,
      ...(result.isError === undefined ? {} : { isError: result.isError }),
    };
  } catch (error) {
    return {
      role: "tool",
      name: call.name,
      toolCallId: call.id,
      content: `Tool execution failed: ${errorMessage(error)}`,
      isError: true,
    };
  }
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

  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new RangeError("maxTurns must be a positive integer");
  }

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const context = createAgentContextSnapshot(state);
    const modelInput = await contextCompiler.compile(context);
    const assistantMessage = await model.generate(modelInput);
    state.messages.push(assistantMessage);

    const toolCalls = assistantMessage.toolCalls ?? [];
    if (toolCalls.length === 0) {
      return assistantMessage;
    }

    for (const call of toolCalls) {
      state.messages.push(await executeToolCall(state, call));
    }
  }

  throw new MaxTurnsExceededError(maxTurns);
}
