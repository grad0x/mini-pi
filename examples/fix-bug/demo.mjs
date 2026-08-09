import { access, cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  DenyCommandPolicy,
  JsonlSessionStore,
  SessionManager,
  SessionRuntime,
  TraceCollector,
  createReadFileTool,
  createRunCommandTool,
  createWriteFileTool,
} from "../../dist/index.js";
import {
  DeniedCommandModel,
  DeterministicFixBugModel,
} from "./deterministic-model.mjs";

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(exampleRoot, "fixture");
const task =
  "Fix the failing test in this workspace. Inspect the relevant files, " +
  "make the minimal code change, run the tests, and finish only after the tests pass.";

export async function prepareFixBugWorkspace() {
  const rootDir = await mkdtemp(join(tmpdir(), "mini-pi-fix-bug-"));
  const workspaceRoot = join(rootDir, "workspace");
  const sessionRoot = join(rootDir, ".mini-pi", "sessions");
  await cp(fixtureRoot, workspaceRoot, { recursive: true });
  return {
    rootDir,
    workspaceRoot,
    sessionRoot,
    async cleanup() {
      await rm(rootDir, { recursive: true });
    },
  };
}

async function runTests(workspaceRoot) {
  return createRunCommandTool({ workspaceRoot }).execute({
    command: "node --test",
  });
}

export async function runFixBugDemo(prepared) {
  const initialTest = await runTests(prepared.workspaceRoot);
  if (initialTest.isError !== true) {
    throw new Error("Fixture tests must fail before the Agent runs");
  }

  const sessionId = "fix-bug-demo";
  const store = new JsonlSessionStore({ rootDir: prepared.sessionRoot });
  const session = await SessionManager.open(sessionId, store);
  const model = new DeterministicFixBugModel();
  const agent = new Agent(model, {
    systemPrompt: "You are a minimal deterministic bug-fixing agent.",
    tools: [
      createReadFileTool({ workspaceRoot: prepared.workspaceRoot }),
      createWriteFileTool({ workspaceRoot: prepared.workspaceRoot }),
      createRunCommandTool({ workspaceRoot: prepared.workspaceRoot }),
    ],
    hooks: [new DenyCommandPolicy({ deniedCommands: ["rm -rf ."] })],
  });
  const trace = new TraceCollector();
  trace.subscribe(agent);
  const result = await new SessionRuntime(agent, session).prompt(task);
  const finalTest = await runTests(prepared.workspaceRoot);
  if (finalTest.isError === true) {
    throw new Error(`Fixture tests still fail:\n${finalTest.content}`);
  }

  const restored = await SessionManager.open(sessionId, store);
  const restoredMessages = restored.getMessages();
  if (restoredMessages.length !== agent.state.messages.length) {
    throw new Error("Restored Session trajectory is incomplete");
  }

  return {
    prepared,
    sessionId,
    sessionFile: join(prepared.sessionRoot, `${sessionId}.jsonl`),
    initialTest,
    finalTest,
    result,
    trace: trace.getEvents(),
    restoredMessages,
    agentMessages: [...agent.state.messages],
    modelInputs: [...model.inputs],
  };
}

export async function runGateAcceptance(workspaceRoot) {
  const sentinel = join(workspaceRoot, "calculator.js");
  await access(sentinel);
  const model = new DeniedCommandModel();
  const agent = new Agent(model, {
    tools: [createRunCommandTool({ workspaceRoot })],
    hooks: [new DenyCommandPolicy({ deniedCommands: ["rm -rf ."] })],
  });
  const trace = new TraceCollector();
  trace.subscribe(agent);
  const result = await agent.prompt("Attempt the denied command safely.");
  await access(sentinel);
  return {
    result,
    trace: trace.getEvents(),
    messages: [...agent.state.messages],
  };
}

export function formatTrace(events) {
  const lines = [];
  for (const event of events) {
    if (event.type === "run_started") {
      lines.push(`Run started: ${event.runId}`);
    } else if (event.type === "turn_started") {
      lines.push(`Turn ${event.turn}`);
    } else if (event.type === "model_call_started") {
      lines.push("  model");
    } else if (event.type === "tool_call_started") {
      lines.push(`  ${event.toolName}`);
    } else if (event.type === "run_finished") {
      lines.push(`Run ${event.status}`);
    }
  }
  return lines.join("\n");
}

export async function readFixedCalculator(workspaceRoot) {
  return readFile(join(workspaceRoot, "calculator.js"), "utf8");
}
