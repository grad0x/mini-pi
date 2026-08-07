import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AgentTool } from "./tool.js";

const execAsync = promisify(exec);

export interface RunCommandToolOptions {
  workspaceRoot: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

interface CommandError extends Error {
  code?: number | string;
  killed?: boolean;
  stdout?: string;
  stderr?: string;
}

function formatResult(
  exitCode: number | string,
  stdout: string,
  stderr: string,
  extra?: string,
): string {
  return [
    `exitCode: ${exitCode}`,
    ...(extra ? [extra] : []),
    "stdout:",
    stdout,
    "stderr:",
    stderr,
  ].join("\n");
}

export function createRunCommandTool(
  options: RunCommandToolOptions,
): AgentTool {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1) {
    throw new RangeError("maxOutputBytes must be a positive integer");
  }

  return {
    name: "run_command",
    description: "Run a shell command with the current workspace as cwd.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
      },
      required: ["command"],
      additionalProperties: false,
    },
    async execute(args) {
      try {
        const { stdout, stderr } = await execAsync(args.command as string, {
          cwd: options.workspaceRoot,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: maxOutputBytes,
        });
        return { content: formatResult(0, stdout, stderr) };
      } catch (error) {
        const commandError = error as CommandError;
        const timedOut = commandError.killed === true;
        const detail = timedOut ? `timedOut: true (${timeoutMs} ms)` : undefined;
        return {
          content: formatResult(
            commandError.code ?? "unknown",
            commandError.stdout ?? "",
            commandError.stderr ?? commandError.message,
            detail,
          ),
          isError: true,
        };
      }
    },
  };
}
