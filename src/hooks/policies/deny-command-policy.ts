import type {
  AgentHook,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "../hook.js";

export interface DenyCommandPolicyOptions {
  deniedCommands: readonly string[];
}

/** Demonstration-only exact command gate; this is not a shell sandbox. */
export class DenyCommandPolicy implements AgentHook {
  private readonly deniedCommands: ReadonlySet<string>;

  constructor(options: DenyCommandPolicyOptions) {
    this.deniedCommands = new Set(options.deniedCommands);
  }

  beforeToolCall(
    context: BeforeToolCallContext,
  ): BeforeToolCallResult | undefined {
    if (
      context.toolCall.name !== "run_command" ||
      typeof context.args.command !== "string" ||
      !this.deniedCommands.has(context.args.command)
    ) {
      return undefined;
    }
    return {
      block: true,
      reason: `Command is denied by policy: ${context.args.command}`,
    };
  }
}
