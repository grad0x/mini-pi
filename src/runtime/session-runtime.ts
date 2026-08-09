import type { Agent } from "../agent/agent.js";
import type { AgentRunResult } from "../agent/types.js";
import type { SessionManager } from "../session/session-manager.js";

export type SessionRuntimeStatus = "ready" | "running" | "faulted";

export class SessionRuntimeFaultedError extends Error {
  constructor() {
    super(
      "SessionRuntime is faulted because durable persistence failed. " +
        "Restore the session before continuing.",
    );
    this.name = "SessionRuntimeFaultedError";
  }
}

/**
 * Coordinates run-boundary persistence. This preserves completed and failed
 * runs, but it is intentionally not crash-durable during an in-flight run.
 */
export class SessionRuntime {
  private currentStatus: SessionRuntimeStatus = "ready";

  constructor(
    readonly agent: Agent,
    readonly session: SessionManager,
  ) {}

  get status(): SessionRuntimeStatus {
    return this.currentStatus;
  }

  async prompt(input: string): Promise<AgentRunResult> {
    if (this.currentStatus === "faulted") {
      throw new SessionRuntimeFaultedError();
    }
    if (this.currentStatus === "running") {
      throw new Error("SessionRuntime is already running");
    }

    this.currentStatus = "running";
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
      this.currentStatus = "faulted";
      if (runFailed) {
        throw new AggregateError(
          [runError, persistenceError],
          "Agent run and session persistence both failed",
        );
      }
      throw persistenceError;
    }

    this.currentStatus = "ready";
    if (runFailed) {
      throw runError;
    }
    if (!result) {
      throw new Error("Agent run completed without a result");
    }
    return result;
  }
}
