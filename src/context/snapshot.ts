import type { AgentState } from "../agent/state.js";
import type { AgentContext } from "./context.js";

export function createAgentContextSnapshot(state: AgentState): AgentContext {
  return {
    systemPrompt: state.systemPrompt,
    messages: [...state.messages],
    tools: [...state.tools],
  };
}
