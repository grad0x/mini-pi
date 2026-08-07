import type { ModelClient } from "../providers/model-client.js";
import type { AgentTool } from "../tools/tool.js";
import { runAgentLoop } from "./loop.js";
import type { AgentState } from "./state.js";
import type { AgentRunResult, UserMessage } from "./types.js";

export interface AgentOptions {
  tools?: AgentTool[];
  maxTurns?: number;
}

/** A stateful runtime that owns conversation history and delegates work to the loop. */
export class Agent {
  readonly state: AgentState;
  private readonly model: ModelClient;
  private readonly maxTurns: number | undefined;

  constructor(model: ModelClient, options: AgentOptions = {}) {
    this.model = model;
    this.maxTurns = options.maxTurns;
    this.state = {
      messages: [],
      tools: [...(options.tools ?? [])],
      status: "idle",
    };
  }

  async prompt(input: string): Promise<AgentRunResult> {
    if (this.state.status === "running") {
      throw new Error("Agent is already running");
    }

    const runStart = this.state.messages.length;
    const userMessage: UserMessage = { role: "user", content: input };
    this.state.messages.push(userMessage);
    this.state.status = "running";

    try {
      const finalMessage = await runAgentLoop(this.state, this.model, {
        ...(this.maxTurns === undefined ? {} : { maxTurns: this.maxTurns }),
      });
      this.state.status = "idle";
      return {
        finalMessage,
        newMessages: this.state.messages.slice(runStart),
      };
    } catch (error) {
      this.state.status = "error";
      throw error;
    }
  }
}
