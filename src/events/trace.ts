import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSource,
} from "./event.js";

/** In-memory ordered event collector for debugging and tests. */
export class TraceCollector {
  private readonly events: AgentEvent[] = [];

  readonly listener: AgentEventListener = (event) => {
    this.events.push(event);
  };

  subscribe(source: AgentEventSource): () => void {
    return source.subscribe(this.listener);
  }

  getEvents(): readonly AgentEvent[] {
    return this.events.slice();
  }
}
