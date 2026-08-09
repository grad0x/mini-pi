import type {
  AgentEvent,
  AgentEventListener,
  AgentEventSink,
} from "./event.js";

export interface AgentEventListenerError {
  readonly event: AgentEvent;
  readonly error: unknown;
}

/** Ordered emitter that isolates observational listener failures. */
export class AgentEventEmitter {
  private readonly listeners = new Set<AgentEventListener>();
  private readonly listenerErrors: AgentEventListenerError[] = [];

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  readonly emit: AgentEventSink = async (event) => {
    Object.freeze(event);
    for (const listener of [...this.listeners]) {
      try {
        await listener(event);
      } catch (error) {
        this.listenerErrors.push(Object.freeze({ event, error }));
      }
    }
  };

  getListenerErrors(): readonly AgentEventListenerError[] {
    return this.listenerErrors.slice();
  }
}
