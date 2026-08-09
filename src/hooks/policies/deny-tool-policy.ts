import type {
  AgentHook,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "../hook.js";

export interface DenyToolPolicyOptions {
  deniedTools: readonly string[];
}

/** Capability gate that blocks tools by exact name. */
export class DenyToolPolicy implements AgentHook {
  private readonly deniedTools: ReadonlySet<string>;

  constructor(options: DenyToolPolicyOptions) {
    this.deniedTools = new Set(options.deniedTools);
  }

  beforeToolCall(
    context: BeforeToolCallContext,
  ): BeforeToolCallResult | undefined {
    if (!this.deniedTools.has(context.toolCall.name)) {
      return undefined;
    }
    return {
      block: true,
      reason: `Tool ${context.toolCall.name} is denied by policy`,
    };
  }
}
