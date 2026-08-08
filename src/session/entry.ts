import type { AgentMessage } from "../agent/types.js";

export interface SessionEntryBase {
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
}

export interface MessageSessionEntry extends SessionEntryBase {
  readonly type: "message";
  readonly message: AgentMessage;
}

export type SessionEntry = MessageSessionEntry;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolCall(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    "arguments" in value
  );
}

function isAgentMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.content !== "string") {
    return false;
  }

  if (value.role === "user") {
    return true;
  }
  if (value.role === "assistant") {
    return (
      value.toolCalls === undefined ||
      (Array.isArray(value.toolCalls) && value.toolCalls.every(isToolCall))
    );
  }
  return (
    value.role === "tool" &&
    typeof value.name === "string" &&
    typeof value.toolCallId === "string" &&
    (value.isError === undefined || typeof value.isError === "boolean")
  );
}

export function assertSessionEntry(value: unknown): asserts value is SessionEntry {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    !(value.parentId === null || typeof value.parentId === "string") ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    value.type !== "message" ||
    !isAgentMessage(value.message)
  ) {
    throw new Error("Invalid message session entry");
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

export function freezeSessionEntry(entry: SessionEntry): SessionEntry {
  return deepFreeze(structuredClone(entry));
}
