const FIXED_CALCULATOR = `export function add(a, b) {
  return a + b;
}
`;

function toolResults(messages, name) {
  return messages.filter(
    (message) => message.role === "tool" && message.name === name,
  );
}

/** Scripted observation-driven model used only by the deterministic demo. */
export class DeterministicFixBugModel {
  inputs = [];

  async generate(input) {
    this.inputs.push(input);
    const readResults = toolResults(input.messages, "read_file");
    const writeResults = toolResults(input.messages, "write_file");
    const commandResults = toolResults(input.messages, "run_command");

    if (readResults.length === 0) {
      return {
        role: "assistant",
        content: "Inspecting the implementation and its test.",
        toolCalls: [
          {
            id: "read-calculator",
            name: "read_file",
            arguments: { path: "calculator.js" },
          },
          {
            id: "read-test",
            name: "read_file",
            arguments: { path: "calculator.test.js" },
          },
        ],
      };
    }

    if (writeResults.length === 0) {
      const implementation = readResults.find(
        (message) => message.toolCallId === "read-calculator",
      );
      const test = readResults.find(
        (message) => message.toolCallId === "read-test",
      );
      if (
        !implementation ||
        implementation.isError ||
        !implementation.content.includes("return a - b") ||
        !test ||
        test.isError ||
        !test.content.includes("add(1, 2)")
      ) {
        return {
          role: "assistant",
          content: "Could not identify the expected calculator bug.",
        };
      }
      return {
        role: "assistant",
        content: "The add function subtracts. Applying the minimal fix.",
        toolCalls: [
          {
            id: "write-calculator",
            name: "write_file",
            arguments: {
              path: "calculator.js",
              content: FIXED_CALCULATOR,
            },
          },
        ],
      };
    }

    if (commandResults.length === 0) {
      const writeResult = writeResults.at(-1);
      if (writeResult?.isError) {
        return { role: "assistant", content: "The code change failed." };
      }
      return {
        role: "assistant",
        content: "The fix is written. Running the test suite.",
        toolCalls: [
          {
            id: "run-tests",
            name: "run_command",
            arguments: { command: "node --test" },
          },
        ],
      };
    }

    const testResult = commandResults.at(-1);
    if (!testResult?.isError && testResult?.content.includes("exitCode: 0")) {
      return {
        role: "assistant",
        content: "Fixed the calculator bug and confirmed all tests pass.",
      };
    }
    return {
      role: "assistant",
      content: "The test suite is still failing after the attempted fix.",
    };
  }
}

export class DeniedCommandModel {
  inputs = [];

  async generate(input) {
    this.inputs.push(input);
    const commandResults = toolResults(input.messages, "run_command");
    if (commandResults.length === 0) {
      return {
        role: "assistant",
        content: "Attempting a denied command.",
        toolCalls: [
          {
            id: "denied-command",
            name: "run_command",
            arguments: { command: "rm -rf ." },
          },
        ],
      };
    }
    const denial = commandResults.at(-1);
    return {
      role: "assistant",
      content: denial?.isError
        ? "The unsafe command was denied; stopping safely."
        : "The command unexpectedly ran.",
    };
  }
}
