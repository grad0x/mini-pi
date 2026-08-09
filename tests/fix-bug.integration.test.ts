import { access, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent, AgentMessage } from "../src/index.js";
import {
  prepareFixBugWorkspace,
  readFixedCalculator,
  runFixBugDemo,
  runGateAcceptance,
  type FixBugDemoResult,
  type PreparedFixBugWorkspace,
} from "../examples/fix-bug/demo.mjs";

function toolNames(messages: readonly AgentMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "assistant"
      ? (message.toolCalls ?? []).map((call) => call.name)
      : [],
  );
}

function eventsOfType<T extends AgentEvent["type"]>(
  events: readonly AgentEvent[],
  type: T,
): Extract<AgentEvent, { type: T }>[] {
  return events.filter(
    (event): event is Extract<AgentEvent, { type: T }> => event.type === type,
  );
}

describe("fix-bug integrated acceptance", () => {
  let prepared: PreparedFixBugWorkspace;
  let demo: FixBugDemoResult;

  beforeAll(async () => {
    prepared = await prepareFixBugWorkspace();
    demo = await runFixBugDemo(prepared);
  }, 20_000);

  afterAll(async () => {
    await prepared.cleanup();
  });

  it("starts from a genuinely failing fixture", () => {
    expect(demo.initialTest.isError).toBe(true);
    expect(demo.initialTest.content).not.toContain("exitCode: 0");
  });

  it("repairs the temporary calculator without modifying the fixture", async () => {
    expect(await readFixedCalculator(prepared.workspaceRoot)).toContain(
      "return a + b",
    );
    expect(
      await readFile(
        new URL("../examples/fix-bug/fixture/calculator.js", import.meta.url),
        "utf8",
      ),
    ).toContain("return a - b");
  });

  it("finishes with the real Node test suite passing", () => {
    expect(demo.finalTest.isError).not.toBe(true);
    expect(demo.finalTest.content).toContain("exitCode: 0");
    expect(demo.result.finalMessage.content).toContain("all tests pass");
  });

  it("records the complete read, write, and command trajectory", () => {
    expect(toolNames(demo.agentMessages)).toEqual([
      "read_file",
      "read_file",
      "write_file",
      "run_command",
    ]);
    expect(
      demo.agentMessages
        .filter((message) => message.role === "tool")
        .map((message) => message.name),
    ).toEqual(["read_file", "read_file", "write_file", "run_command"]);
  });

  it("emits exactly one completed Run lifecycle", () => {
    expect(eventsOfType(demo.trace, "run_started")).toHaveLength(1);
    expect(eventsOfType(demo.trace, "run_finished")).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("closes every started Turn", () => {
    expect(
      eventsOfType(demo.trace, "turn_started").map((event) => event.turn),
    ).toEqual([1, 2, 3, 4]);
    expect(
      eventsOfType(demo.trace, "turn_finished").map((event) => event.turn),
    ).toEqual([1, 2, 3, 4]);
  });

  it("closes every started Tool call with the same identity", () => {
    const started = eventsOfType(demo.trace, "tool_call_started").map(
      ({ toolCallId, toolName, turn }) => ({ toolCallId, toolName, turn }),
    );
    const finished = eventsOfType(demo.trace, "tool_call_finished").map(
      ({ toolCallId, toolName, turn }) => ({ toolCallId, toolName, turn }),
    );
    expect(finished).toEqual(started);
  });

  it("restores the full trajectory from the JSONL Session", async () => {
    await access(demo.sessionFile);
    expect(demo.restoredMessages).toEqual(demo.agentMessages);
    expect(demo.restoredMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "tool",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
  });

  it("uses the full transcript for each default context projection", () => {
    expect(demo.modelInputs.map((input) => input.messages.length)).toEqual([
      1, 4, 6, 8,
    ]);
    for (const input of demo.modelInputs) {
      expect(demo.agentMessages.slice(0, input.messages.length)).toEqual(
        input.messages,
      );
    }
  });

  it("blocks the denied command without an effect and lets the Run recover", async () => {
    const before = await readFixedCalculator(prepared.workspaceRoot);
    const gate = await runGateAcceptance(prepared.workspaceRoot);
    const after = await readFixedCalculator(prepared.workspaceRoot);
    const blocked = eventsOfType(gate.trace, "tool_call_finished");
    const toolResult = gate.messages.find(
      (message) => message.role === "tool" && message.toolCallId === "denied-command",
    );

    expect(after).toBe(before);
    expect(blocked).toEqual([
      expect.objectContaining({
        toolName: "run_command",
        isError: true,
        blocked: true,
      }),
    ]);
    expect(toolResult).toMatchObject({
      role: "tool",
      isError: true,
      content: expect.stringContaining("denied by policy"),
    });
    expect(gate.result.run.status).toBe("completed");
    expect(gate.result.finalMessage.content).toContain("stopping safely");
  });
});
