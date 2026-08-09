import type { ModelClient } from "../providers/model-client.js";
import {
  DefaultContextCompiler,
  type ContextCompiler,
} from "../context/compiler.js";
import type { AgentTool } from "../tools/tool.js";
import { AgentEventEmitter } from "../events/emitter.js";
import type { AgentEventListener } from "../events/event.js";
import type { AgentHook } from "../hooks/hook.js";
import {
  completeAgentRun,
  createAgentRun,
  failAgentRun,
} from "../runtime/run.js";
import { runAgentLoop } from "./loop.js";
import type { AgentState } from "./state.js";
import type { AgentMessage, AgentRunResult, UserMessage } from "./types.js";

export interface AgentOptions {
  tools?: AgentTool[];
  maxTurns?: number;
  initialMessages?: readonly AgentMessage[];
  systemPrompt?: string;
  contextCompiler?: ContextCompiler;
  hooks?: readonly AgentHook[];
}

/** A stateful runtime that owns conversation history and delegates work to the loop. */
export class Agent {
  readonly state: AgentState;
  private readonly events = new AgentEventEmitter();
  private readonly model: ModelClient;
  private readonly maxTurns: number | undefined;
  private readonly contextCompiler: ContextCompiler;
  private readonly hooks: AgentHook[];

  constructor(model: ModelClient, options: AgentOptions = {}) {
    this.model = model;
    this.maxTurns = options.maxTurns;
    this.contextCompiler =
      options.contextCompiler ?? new DefaultContextCompiler();
    this.hooks = [...(options.hooks ?? [])];
    this.state = {
      systemPrompt: options.systemPrompt ?? "",
      messages: [...(options.initialMessages ?? [])],
      tools: [...(options.tools ?? [])],
      status: "idle",
    };
  }

  subscribe(listener: AgentEventListener): () => void {
    return this.events.subscribe(listener);
  }

  getListenerErrors() {
    return this.events.getListenerErrors();
  }

  async prompt(input: string): Promise<AgentRunResult> {
    if (this.state.status === "running") {
      throw new Error("Agent is already running");
    }

    const runStart = this.state.messages.length;
    const runningRun = createAgentRun();
    const userMessage: UserMessage = { role: "user", content: input };
    this.state.messages.push(userMessage);
    this.state.status = "running";
    await this.events.emit({
      type: "run_started",
      runId: runningRun.id,
      timestamp: runningRun.startedAt,
    });

    try {
      const finalMessage = await runAgentLoop(this.state, this.model, {
        ...(this.maxTurns === undefined ? {} : { maxTurns: this.maxTurns }),
        contextCompiler: this.contextCompiler,
        runId: runningRun.id,
        emit: this.events.emit,
        hooks: this.hooks,
      });
      this.state.status = "idle";
      const run = completeAgentRun(runningRun);
      await this.events.emit({
        type: "run_finished",
        runId: run.id,
        status: "completed",
        timestamp: run.endedAt ?? Date.now(),
      });
      return {
        run,
        finalMessage,
        newMessages: this.state.messages.slice(runStart),
      };
    } catch (error) {
      this.state.status = "error";
      const errorText = formatRunError(error);
      const run = failAgentRun(runningRun, errorText);
      await this.events.emit({
        type: "run_finished",
        runId: run.id,
        status: "failed",
        error: errorText,
        timestamp: run.endedAt ?? Date.now(),
      });
      throw error;
    }
  }
}

function formatRunError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
