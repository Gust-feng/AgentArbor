export type AgentMessage = {
  readonly id: string;
  readonly traceId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: string;
  readonly sourceRef?: string;
};

export interface AgentMailbox {
  route(message: AgentMessage): void;
  pending(agentId: string): number;
  drain(agentId: string): AgentMessage[];
  drainByType(agentId: string, type: string): AgentMessage[];
  peek(agentId: string): AgentMessage[];
}

export class InMemoryMailbox implements AgentMailbox {
  private readonly queues = new Map<string, AgentMessage[]>();

  route(message: AgentMessage): void {
    const queued = this.queues.get(message.toAgentId);
    const clone: AgentMessage = {
      ...message,
      payload: structuredClone(message.payload),
    };
    if (queued) {
      queued.push(clone);
    } else {
      this.queues.set(message.toAgentId, [clone]);
    }
  }

  pending(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }

  drain(agentId: string): AgentMessage[] {
    const messages = this.queues.get(agentId) ?? [];
    this.queues.set(agentId, []);
    return messages.map((m) => ({ ...m, payload: structuredClone(m.payload) }));
  }

  drainByType(agentId: string, type: string): AgentMessage[] {
    const messages = this.queues.get(agentId) ?? [];
    const matched: AgentMessage[] = [];
    const remaining: AgentMessage[] = [];
    for (const m of messages) {
      if (m.type === type) {
        matched.push({ ...m, payload: structuredClone(m.payload) });
      } else {
        remaining.push(m);
      }
    }
    this.queues.set(agentId, remaining);
    return matched;
  }

  peek(agentId: string): AgentMessage[] {
    const messages = this.queues.get(agentId) ?? [];
    return messages.map((m) => ({ ...m, payload: structuredClone(m.payload) }));
  }
}
