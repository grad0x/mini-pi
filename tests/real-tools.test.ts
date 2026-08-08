import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  Agent,
  createReadFileTool,
  createRunCommandTool,
  createWriteFileTool,
  type ModelClient,
} from "../src/index.js";

const temporaryRoots: string[] = [];

async function createWorkspace(): Promise<{
  root: string;
  workspace: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "mini-pi-tools-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  temporaryRoots.push(root);
  return { root, workspace };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("read_file", () => {
  it("reads a UTF-8 file from the workspace", async () => {
    const { workspace } = await createWorkspace();
    await writeFile(join(workspace, "hello.txt"), "hello 世界", "utf8");

    const result = await createReadFileTool({ workspaceRoot: workspace }).execute({
      path: "hello.txt",
    });

    expect(result).toEqual({ content: "hello 世界" });
  });

  it("runs through the complete Agent model-tool-model trajectory", async () => {
    const { workspace } = await createWorkspace();
    await writeFile(join(workspace, "hello.txt"), "from workspace", "utf8");
    const model: ModelClient = {
      generate: vi.fn(async ({ messages }) => {
        const lastMessage = messages.at(-1);
        if (lastMessage?.role === "tool") {
          return { role: "assistant", content: `done: ${lastMessage.content}` };
        }
        return {
          role: "assistant",
          content: "Reading hello.txt",
          toolCalls: [
            { id: "read-1", name: "read_file", arguments: { path: "hello.txt" } },
          ],
        };
      }),
    };
    const agent = new Agent(model, {
      tools: [createReadFileTool({ workspaceRoot: workspace })],
    });

    const result = await agent.prompt("read the file");

    expect(result.newMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.newMessages[2]).toMatchObject({
      role: "tool",
      toolCallId: "read-1",
      content: "from workspace",
    });
    expect(result.finalMessage.content).toBe("done: from workspace");
  });

  it("rejects path traversal outside the workspace", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, "outside.txt"), "secret", "utf8");

    const result = await createReadFileTool({ workspaceRoot: workspace }).execute({
      path: "../outside.txt",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("outside the workspace");
    expect(result.content).not.toContain("secret");
  });

  it("rejects symbolic links that resolve outside the workspace", async () => {
    const { root, workspace } = await createWorkspace();
    await writeFile(join(root, "outside.txt"), "secret", "utf8");
    await symlink(join(root, "outside.txt"), join(workspace, "linked.txt"));

    const result = await createReadFileTool({ workspaceRoot: workspace }).execute({
      path: "linked.txt",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("outside the workspace");
  });
});

describe("write_file", () => {
  it("creates parent directories and writes a UTF-8 file", async () => {
    const { workspace } = await createWorkspace();
    const tool = createWriteFileTool({ workspaceRoot: workspace });

    const result = await tool.execute({
      path: "src/generated.txt",
      content: "generated 世界",
    });

    expect(result).toEqual({
      content: "Wrote 16 bytes to src/generated.txt",
    });
    expect(await readFile(join(workspace, "src/generated.txt"), "utf8")).toBe(
      "generated 世界",
    );
  });

  it("rejects path traversal and does not create the outside file", async () => {
    const { root, workspace } = await createWorkspace();
    const result = await createWriteFileTool({ workspaceRoot: workspace }).execute({
      path: "../outside.txt",
      content: "should not exist",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("outside the workspace");
    await expect(readFile(join(root, "outside.txt"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects parent directory symlinks that escape the workspace", async () => {
    const { root, workspace } = await createWorkspace();
    const outsideDirectory = join(root, "outside");
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, join(workspace, "linked-directory"));

    const result = await createWriteFileTool({ workspaceRoot: workspace }).execute({
      path: "linked-directory/escaped.txt",
      content: "should not exist",
    });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("outside the workspace");
    await expect(
      readFile(join(outsideDirectory, "escaped.txt"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("run_command", () => {
  it("returns stdout and the exit code", async () => {
    const { workspace } = await createWorkspace();
    const tool = createRunCommandTool({ workspaceRoot: workspace });
    const command = `${JSON.stringify(process.execPath)} -e "console.log('hello')"`;

    const result = await tool.execute({ command });

    expect(result.isError).toBeUndefined();
    expect(result.content).toContain("exitCode: 0");
    expect(result.content).toContain("stdout:\nhello");
  });

  it("always executes with the workspace as cwd", async () => {
    const { workspace } = await createWorkspace();
    const tool = createRunCommandTool({ workspaceRoot: workspace });
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write(process.cwd())"`;

    const result = await tool.execute({ command });

    expect(result.content).toContain(`stdout:\n${await realpath(workspace)}`);
  });

  it("terminates commands that exceed the timeout", async () => {
    const { workspace } = await createWorkspace();
    const tool = createRunCommandTool({ workspaceRoot: workspace, timeoutMs: 50 });
    const command = `${JSON.stringify(process.execPath)} -e "setTimeout(() => {}, 1000)"`;
    const startedAt = Date.now();

    const result = await tool.execute({ command });

    expect(Date.now() - startedAt).toBeLessThan(900);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("timedOut: true (50 ms)");
  });

  it("returns an error when stdout exceeds maxOutputBytes", async () => {
    const { workspace } = await createWorkspace();
    const tool = createRunCommandTool({
      workspaceRoot: workspace,
      maxOutputBytes: 32,
    });
    const command = `${JSON.stringify(process.execPath)} -e "process.stdout.write('x'.repeat(10000))"`;

    const result = await tool.execute({ command });

    expect(result.isError).toBe(true);
    expect(result.content).toContain("exitCode:");
  });
});
