import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { assertSessionEntry, type SessionEntry } from "./entry.js";
import type { SessionStore } from "./store.js";

export interface JsonlSessionStoreOptions {
  rootDir: string;
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(
      `Invalid session id "${sessionId}": use only letters, numbers, - and _`,
    );
  }
}

export class JsonlSessionStore implements SessionStore {
  private readonly rootDir: string;

  constructor(options: JsonlSessionStoreOptions) {
    this.rootDir = resolve(options.rootDir);
  }

  private sessionPath(sessionId: string): string {
    validateSessionId(sessionId);
    return join(this.rootDir, `${sessionId}.jsonl`);
  }

  async load(sessionId: string): Promise<SessionEntry[]> {
    const path = this.sessionPath(sessionId);
    let content: string;
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    if (content.length === 0) {
      return [];
    }

    const lines = content.split("\n");
    if (lines.at(-1) === "") {
      lines.pop();
    }

    return lines.map((line, index) => {
      const lineNumber = index + 1;
      try {
        const entry: unknown = JSON.parse(
          line.endsWith("\r") ? line.slice(0, -1) : line,
        );
        assertSessionEntry(entry);
        return entry;
      } catch (error) {
        throw new Error(
          `Failed to load session "${sessionId}" at line ${lineNumber}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }
    });
  }

  async append(sessionId: string, entry: SessionEntry): Promise<void> {
    const path = this.sessionPath(sessionId);
    assertSessionEntry(entry);
    await mkdir(this.rootDir, { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
