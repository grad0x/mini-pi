import type { ModelInput, ModelToolDefinition } from "../providers/model-client.js";
import type { AgentContext } from "./context.js";

export interface ContextCompiler {
  compile(context: AgentContext): ModelInput | Promise<ModelInput>;
}

function toolDefinitions(context: AgentContext): ModelToolDefinition[] {
  return context.tools.map(({ name, description, parameters }) => ({
    name,
    description,
    parameters,
  }));
}

/** Preserves the full snapshot and matches the pre-compiler model behavior. */
export class DefaultContextCompiler implements ContextCompiler {
  compile(context: AgentContext): ModelInput {
    return {
      systemPrompt: context.systemPrompt,
      messages: [...context.messages],
      tools: toolDefinitions(context),
    };
  }
}

export interface RecentRunsContextCompilerOptions {
  maxRuns: number;
}

/** Projects complete user-started run segments without changing runtime state. */
export class RecentRunsContextCompiler implements ContextCompiler {
  private readonly maxRuns: number;
  private readonly defaultCompiler = new DefaultContextCompiler();

  constructor(options: RecentRunsContextCompilerOptions) {
    if (!Number.isInteger(options.maxRuns) || options.maxRuns < 1) {
      throw new RangeError("maxRuns must be a positive integer");
    }
    this.maxRuns = options.maxRuns;
  }

  compile(context: AgentContext): ModelInput {
    const runStarts: number[] = [];
    context.messages.forEach((message, index) => {
      if (message.role === "user") {
        runStarts.push(index);
      }
    });

    if (runStarts.length <= this.maxRuns) {
      return this.defaultCompiler.compile(context);
    }

    const firstSelectedRun = runStarts[runStarts.length - this.maxRuns];
    return this.defaultCompiler.compile({
      ...context,
      messages: context.messages.slice(firstSelectedRun),
    });
  }
}
