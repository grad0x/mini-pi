import {
  formatTrace,
  prepareFixBugWorkspace,
  runFixBugDemo,
  runGateAcceptance,
} from "./demo.mjs";

const prepared = await prepareFixBugWorkspace();
const keepWorkspace = process.env.MINI_PI_KEEP_DEMO === "1";

try {
  console.log("Mini Pi Fix Bug Demo\n");
  const demo = await runFixBugDemo(prepared);
  console.log("Initial tests: FAIL\n");
  console.log(formatTrace(demo.trace));
  console.log("\nFinal tests: PASS");
  console.log(`Session: ${demo.sessionFile}`);
  console.log(`Restored messages: ${demo.restoredMessages.length}`);

  const gate = await runGateAcceptance(prepared.workspaceRoot);
  const blocked = gate.trace.some(
    (event) =>
      event.type === "tool_call_finished" && event.blocked === true,
  );
  if (!blocked) {
    throw new Error("Policy gate acceptance did not block the command");
  }
  console.log("Policy gate: PASS");

  if (keepWorkspace) {
    console.log(`Workspace retained: ${prepared.rootDir}`);
  }
} finally {
  if (!keepWorkspace) {
    await prepared.cleanup();
  }
}
