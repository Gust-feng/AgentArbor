export type AgentMessage<TPayload = unknown> = {
  readonly id: string;
  readonly traceId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly type: string;
  readonly payload: TPayload;
  readonly createdAt: string;
  readonly sourceRef?: string;
};

export type Mailbox = {
  route<TPayload>(message: AgentMessage<TPayload>): void;
  peek(agentId: string): readonly AgentMessage[];
  drain(agentId: string): readonly AgentMessage[];
  drainByType(agentId: string, type: string): readonly AgentMessage[];
  pending(agentId: string): number;
};

export class InMemoryMailbox implements Mailbox {
  private readonly queues = new Map<string, AgentMessage[]>();

  route<TPayload>(message: AgentMessage<TPayload>): void {
    const queue = this.queues.get(message.toAgentId) ?? [];
    queue.push(cloneAgentMessage(message));
    this.queues.set(message.toAgentId, queue);
  }

  peek(agentId: string): readonly AgentMessage[] {
    return (this.queues.get(agentId) ?? []).map(cloneAgentMessage);
  }

  drain(agentId: string): readonly AgentMessage[] {
    const messages = this.peek(agentId);
    this.queues.set(agentId, []);
    return messages;
  }

  drainByType(agentId: string, type: string): readonly AgentMessage[] {
    const messages = this.queues.get(agentId) ?? [];
    const matching: AgentMessage[] = [];
    const remaining: AgentMessage[] = [];
    for (const message of messages) {
      if (message.type === type) {
        matching.push(cloneAgentMessage(message));
      } else {
        remaining.push(message);
      }
    }
    this.queues.set(agentId, remaining);
    return matching;
  }

  pending(agentId: string): number {
    return this.queues.get(agentId)?.length ?? 0;
  }
}

export function cloneAgentMessage<TPayload>(message: AgentMessage<TPayload>): AgentMessage<TPayload> {
  return globalThis.structuredClone(message);
}
