import type { Agent } from "../agent/agent.js";
import type { AgentRunResult } from "../agent/types.js";
import type { SessionManager } from "../session/session-manager.js";

/**
 * Coordinates run-boundary persistence. This preserves completed and failed
 * runs, but it is intentionally not crash-durable during an in-flight run.
 */
export class SessionRuntime {
  constructor(
    readonly agent: Agent,
    readonly session: SessionManager,
  ) {}

  async prompt(input: string): Promise<AgentRunResult> {
    const runStart = this.agent.state.messages.length;
    let result: AgentRunResult | undefined;
    let runFailed = false;
    let runError: unknown;

    try {
      result = await this.agent.prompt(input);
    } catch (error) {
      runFailed = true;
      runError = error;
    }

    try {
      const newMessages = this.agent.state.messages.slice(runStart);
      for (const message of newMessages) {
        await this.session.appendMessage(message);
      }
    } catch (persistenceError) {
      if (runFailed) {
        throw new AggregateError(
          [runError, persistenceError],
          "Agent run and session persistence both failed",
        );
      }
      throw persistenceError;
    }

    if (runFailed) {
      throw runError;
    }
    if (!result) {
      throw new Error("Agent run completed without a result");
    }
    return result;
  }
}
