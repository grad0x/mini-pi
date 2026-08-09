import type {
  AgentEvent,
  AgentMessage,
  AgentRunResult,
  ModelInput,
  ToolResult,
} from "../../src/index.js";

export interface PreparedFixBugWorkspace {
  rootDir: string;
  workspaceRoot: string;
  sessionRoot: string;
  cleanup(): Promise<void>;
}

export interface FixBugDemoResult {
  prepared: PreparedFixBugWorkspace;
  sessionId: string;
  sessionFile: string;
  initialTest: ToolResult;
  finalTest: ToolResult;
  result: AgentRunResult;
  trace: readonly AgentEvent[];
  restoredMessages: AgentMessage[];
  agentMessages: AgentMessage[];
  modelInputs: ModelInput[];
}

export interface GateAcceptanceResult {
  result: AgentRunResult;
  trace: readonly AgentEvent[];
  messages: AgentMessage[];
}

export function prepareFixBugWorkspace(): Promise<PreparedFixBugWorkspace>;
export function runFixBugDemo(
  prepared: PreparedFixBugWorkspace,
): Promise<FixBugDemoResult>;
export function runGateAcceptance(
  workspaceRoot: string,
): Promise<GateAcceptanceResult>;
export function formatTrace(events: readonly AgentEvent[]): string;
export function readFixedCalculator(workspaceRoot: string): Promise<string>;
