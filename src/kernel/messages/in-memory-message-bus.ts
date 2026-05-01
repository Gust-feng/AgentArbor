import type { ArborMessage, ArborMessageType } from "../../domain/common.js";
import type { InMemoryEventLog } from "../events/in-memory-event-log.js";

type SubscriptionType = ArborMessageType | "*";
type MessageHandler = (message: ArborMessage) => void;

export class MessageBusPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessageBusPolicyError";
  }
}

export class InMemoryMessageBus {
  private readonly messages: ArborMessage[] = [];
  private readonly subscribers = new Map<SubscriptionType, Set<MessageHandler>>();

  constructor(private readonly eventLog: InMemoryEventLog) {}

  publish(message: ArborMessage): void {
    this.assertNoInternalPrivateMessage(message);
    this.messages.push(message);
    this.eventLog.append(message);
    this.notify(message.type, message);
    this.notify("*", message);
  }

  subscribe(type: SubscriptionType, handler: MessageHandler): () => void {
    const handlers = this.subscribers.get(type) ?? new Set<MessageHandler>();
    handlers.add(handler);
    this.subscribers.set(type, handlers);
    return () => handlers.delete(handler);
  }

  getMessages(type?: ArborMessageType): ArborMessage[] {
    return type === undefined ? [...this.messages] : this.messages.filter((message) => message.type === type);
  }

  private notify(type: SubscriptionType, message: ArborMessage): void {
    for (const handler of this.subscribers.get(type) ?? []) {
      handler(message);
    }
  }

  private assertNoInternalPrivateMessage(message: ArborMessage): void {
    if (message.to !== undefined && "id" in message.to && message.from.role !== "user") {
      throw new MessageBusPolicyError(
        "Internal agents must coordinate through role, group, or broadcast messages; direct private agent messages are blocked."
      );
    }
  }
}
