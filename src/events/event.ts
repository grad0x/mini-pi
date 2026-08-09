export interface EventBase {
  readonly runId: string;
  readonly timestamp: number;
}

export interface RunStartedEvent extends EventBase {
  readonly type: "run_started";
}

export interface TurnStartedEvent extends EventBase {
  readonly type: "turn_started";
  readonly turn: number;
}

export interface ModelCallStartedEvent extends EventBase {
  readonly type: "model_call_started";
  readonly turn: number;
}

export interface ModelCallFinishedEvent extends EventBase {
  readonly type: "model_call_finished";
  readonly turn: number;
  readonly isError: boolean;
  readonly hasToolCalls: boolean;
  readonly toolCallCount: number;
}

export interface ToolCallStartedEvent extends EventBase {
  readonly type: "tool_call_started";
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
}

export interface ToolCallFinishedEvent extends EventBase {
  readonly type: "tool_call_finished";
  readonly turn: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly blocked: boolean;
}

export interface TurnFinishedEvent extends EventBase {
  readonly type: "turn_finished";
  readonly turn: number;
  readonly toolCallCount: number;
  readonly hasError: boolean;
}

export interface CompletedRunFinishedEvent extends EventBase {
  readonly type: "run_finished";
  readonly status: "completed";
}

export interface FailedRunFinishedEvent extends EventBase {
  readonly type: "run_finished";
  readonly status: "failed";
  readonly error: string;
}

export type RunFinishedEvent =
  | CompletedRunFinishedEvent
  | FailedRunFinishedEvent;

export type AgentEvent =
  | RunStartedEvent
  | TurnStartedEvent
  | ModelCallStartedEvent
  | ModelCallFinishedEvent
  | ToolCallStartedEvent
  | ToolCallFinishedEvent
  | TurnFinishedEvent
  | RunFinishedEvent;

export type AgentEventListener =
  (event: AgentEvent) => void | Promise<void>;

export type AgentEventSink =
  (event: AgentEvent) => void | Promise<void>;

export interface AgentEventSource {
  subscribe(listener: AgentEventListener): () => void;
}
