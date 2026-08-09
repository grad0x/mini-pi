import { randomUUID } from "node:crypto";

export type AgentRunStatus = "running" | "completed" | "failed";

export interface AgentRun {
  readonly id: string;
  readonly status: AgentRunStatus;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly error?: string;
}

export function createAgentRun(): AgentRun {
  return Object.freeze({
    id: randomUUID(),
    status: "running",
    startedAt: Date.now(),
  });
}

export function completeAgentRun(run: AgentRun): AgentRun {
  return Object.freeze({ ...run, status: "completed", endedAt: Date.now() });
}

export function failAgentRun(run: AgentRun, error: string): AgentRun {
  return Object.freeze({
    ...run,
    status: "failed",
    endedAt: Date.now(),
    error,
  });
}
