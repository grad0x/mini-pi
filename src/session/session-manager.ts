import { randomUUID } from "node:crypto";
import type { AgentMessage } from "../agent/types.js";
import {
  assertSessionEntry,
  freezeSessionEntry,
  type MessageSessionEntry,
  type SessionEntry,
} from "./entry.js";
import type { SessionStore } from "./store.js";

export class SessionConsistencyError extends Error {
  constructor(sessionId: string, detail: string) {
    super(`Session consistency error for "${sessionId}": ${detail}`);
    this.name = "SessionConsistencyError";
  }
}

function validateLinearHistory(sessionId: string, entries: SessionEntry[]): void {
  const seenIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    try {
      assertSessionEntry(entry);
    } catch (error) {
      throw new SessionConsistencyError(
        sessionId,
        `entry ${index + 1} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (seenIds.has(entry.id)) {
      throw new SessionConsistencyError(
        sessionId,
        `duplicate entry id ${entry.id}`,
      );
    }
    seenIds.add(entry.id);

    const expectedParent = index === 0 ? null : entries[index - 1]?.id;
    if (entry.parentId !== expectedParent) {
      throw new SessionConsistencyError(
        sessionId,
        `entry ${index + 1} has parentId ${String(entry.parentId)}, expected ${String(expectedParent)}`,
      );
    }
  }
}

/** Owns the durable linear session history and its current leaf cursor. */
export class SessionManager {
  private readonly entries: SessionEntry[];
  private leafId: string | null;
  private appendQueue: Promise<void> = Promise.resolve();

  private constructor(
    readonly sessionId: string,
    private readonly store: SessionStore,
    entries: SessionEntry[],
  ) {
    this.entries = entries.map(freezeSessionEntry);
    this.leafId = this.entries.at(-1)?.id ?? null;
  }

  static async open(
    sessionId: string,
    store: SessionStore,
  ): Promise<SessionManager> {
    const entries = await store.load(sessionId);
    validateLinearHistory(sessionId, entries);
    return new SessionManager(sessionId, store, entries);
  }

  getEntries(): readonly SessionEntry[] {
    return this.entries.slice();
  }

  getMessages(): AgentMessage[] {
    return this.entries.map((entry) => structuredClone(entry.message));
  }

  appendMessage(message: AgentMessage): Promise<MessageSessionEntry> {
    const operation = this.appendQueue.then(async () => {
      const entry = freezeSessionEntry({
        id: randomUUID(),
        parentId: this.leafId,
        timestamp: Date.now(),
        type: "message",
        message,
      });

      await this.store.append(this.sessionId, entry);
      this.entries.push(entry);
      this.leafId = entry.id;
      return entry;
    });

    this.appendQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}
