import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Agent,
  DenyCommandPolicy,
  JsonlSessionStore,
  OpenAICompatibleModelClient,
  SessionManager,
  SessionRuntime,
  TraceCollector,
  createReadFileTool,
  createRunCommandTool,
  createWriteFileTool,
} from "../../dist/index.js";

const exampleRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(exampleRoot, "..", "fix-bug", "fixture");
const systemPrompt = `You are a coding agent working inside a restricted workspace.

Use the provided tools to inspect and modify the workspace.

For coding tasks:
- inspect relevant files before editing;
- make the smallest reasonable change;
- run the relevant tests after editing;
- if tests fail, inspect the result and continue;
- do not claim success until verification passes.`;
const task =
  "Fix the failing test in this workspace. Inspect the relevant files, " +
  "make the minimal code change, run the tests, and finish only after the tests pass.";

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }
  return value;
}

async function prepareWorkspace() {
  const rootDir = await mkdtemp(join(tmpdir(), "mini-pi-real-llm-"));
  const workspaceRoot = join(rootDir, "workspace");
  const sessionRoot = join(rootDir, ".mini-pi", "sessions");
  await cp(fixtureRoot, workspaceRoot, { recursive: true });
  return { rootDir, workspaceRoot, sessionRoot };
}

async function runTests(workspaceRoot) {
  return createRunCommandTool({ workspaceRoot }).execute({
    command: "node --test",
  });
}

async function main() {
  const baseUrl = requiredEnvironment("MINI_PI_LLM_BASE_URL");
  const apiKey = requiredEnvironment("MINI_PI_LLM_API_KEY");
  const modelName = requiredEnvironment("MINI_PI_LLM_MODEL");
  const prepared = await prepareWorkspace();
  const keepWorkspace = process.env.MINI_PI_KEEP_DEMO === "1";

  try {
    console.log("Mini Pi Real LLM Fix Bug Demo\n");
    const initialTest = await runTests(prepared.workspaceRoot);
    if (initialTest.isError !== true) {
      throw new Error("Fixture tests must fail before the Agent runs");
    }
    console.log("Initial tests: FAIL");

    const sessionId = "real-llm-fix-bug";
    const store = new JsonlSessionStore({ rootDir: prepared.sessionRoot });
    const session = await SessionManager.open(sessionId, store);
    const model = new OpenAICompatibleModelClient({
      baseUrl,
      apiKey,
      model: modelName,
    });
    const agent = new Agent(model, {
      systemPrompt,
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
    const events = trace.getEvents();
    const turns = events.filter((event) => event.type === "turn_started");
    const modelCalls = events.filter(
      (event) => event.type === "model_call_started",
    );
    const toolCalls = events.filter(
      (event) => event.type === "tool_call_started",
    );
    const restored = await SessionManager.open(sessionId, store);
    const sessionFile = join(prepared.sessionRoot, `${sessionId}.jsonl`);

    console.log(`Run ID: ${result.run.id}`);
    console.log(`Turns: ${turns.length}`);
    console.log(`Model calls: ${modelCalls.length}`);
    console.log(
      `Tool calls: ${toolCalls.length === 0
        ? "none"
        : toolCalls.map((event) => `T${event.turn}:${event.toolName}`).join(", ")}`,
    );
    console.log(`Trace events: ${events.length}`);
    console.log(`Final response: ${result.finalMessage.content}`);
    console.log(`Final tests: ${finalTest.isError === true ? "FAIL" : "PASS"}`);
    console.log(`Session: ${sessionFile}`);
    console.log(`Restored messages: ${restored.getMessages().length}`);

    if (finalTest.isError === true) {
      throw new Error(`Fixture tests still fail:\n${finalTest.content}`);
    }
    if (keepWorkspace) {
      console.log(`Workspace retained: ${prepared.rootDir}`);
    }
  } finally {
    if (!keepWorkspace) {
      await rm(prepared.rootDir, { recursive: true });
    }
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
