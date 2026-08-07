import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool } from "./tool.js";
import type { FileToolOptions } from "./read-file.js";
import { resolveWorkspaceWritePath } from "./workspace.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWriteFileTool(options: FileToolOptions): AgentTool {
  return {
    name: "write_file",
    description: "Write a UTF-8 file inside the current workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path" },
        content: { type: "string", description: "Complete file content" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    async execute(args) {
      try {
        const path = await resolveWorkspaceWritePath(
          options.workspaceRoot,
          args.path as string,
        );
        await mkdir(dirname(path), { recursive: true });
        const content = args.content as string;
        await writeFile(path, content, "utf8");
        return {
          content: `Wrote ${Buffer.byteLength(content, "utf8")} bytes to ${args.path as string}`,
        };
      } catch (error) {
        return { content: `write_file failed: ${errorMessage(error)}`, isError: true };
      }
    },
  };
}
