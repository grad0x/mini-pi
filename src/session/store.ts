import type { SessionEntry } from "./entry.js";

/** Persistence boundary for append-only session entries. */
export interface SessionStore {
  load(sessionId: string): Promise<SessionEntry[]>;
  append(sessionId: string, entry: SessionEntry): Promise<void>;
}
