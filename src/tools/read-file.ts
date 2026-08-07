import { readFile, stat } from "node:fs/promises";
import type { AgentTool } from "./tool.js";
import { resolveExistingWorkspacePath } from "./workspace.js";

export interface FileToolOptions {
  workspaceRoot: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createReadFileTool(options: FileToolOptions): AgentTool {
  return {
    name: "read_file",
    description: "Read a UTF-8 file inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
      },
      required: ["path"],
      additionalProperties: false,
    },
    async execute(args) {
      try {
        const path = await resolveExistingWorkspacePath(
          options.workspaceRoot,
          args.path as string,
        );
        if (!(await stat(path)).isFile()) {
          return { content: "read_file failed: Path is not a file", isError: true };
        }
        return { content: await readFile(path, "utf8") };
      } catch (error) {
        return { content: `read_file failed: ${errorMessage(error)}`, isError: true };
      }
    },
  };
}
