import type { ArborMessage, ArborMessageType } from "../../../domain/common.js";
import { createId } from "../../../kernel/id.js";
import type { MinimalRuntime } from "../../runtime.js";
import type { IntelligenceChannel } from "../../../domain/intelligence/index.js";
import type { RootletClusterKind } from "../../../domain/underground/index.js";
import type { UndergroundSharedContext } from "./shared-context.js";

export const ROOTLET_INVOCATION_REQUESTED = "rootlet.invocation_requested" as const;

export class UndergroundAgentRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndergroundAgentRunnerError";
  }
}

export type RootletInvocationRequestedMessage = {
  readonly id: string;
  readonly type: typeof ROOTLET_INVOCATION_REQUESTED;
  readonly traceId: string;
  readonly payload: {
    readonly goalId: string;
    readonly planId: string;
    readonly clusterId: string;
    readonly rootletKind: RootletClusterKind;
    readonly invocationId: string;
  };
};

export type UndergroundRuntimeMessage = ArborMessage | RootletInvocationRequestedMessage;

export type UndergroundAgentMessageHandler<TMessage extends UndergroundRuntimeMessage> = (
  message: TMessage
) => void | Promise<void>;

export type UndergroundQueuedAgentMessage = {
  readonly agentId: string;
  readonly message: UndergroundRuntimeMessage;
  readonly handler: UndergroundAgentMessageHandler<UndergroundRuntimeMessage>;
  readonly isPublicMessage: boolean;
  readonly requiresAsync: boolean;
};

type InternalSubscription = {
  readonly agentId: string;
  readonly handler: UndergroundAgentMessageHandler<RootletInvocationRequestedMessage>;
  readonly requiresAsync: boolean | ((message: RootletInvocationRequestedMessage) => boolean);
};

export type UndergroundAgent = {
  readonly agentId: string;
  start(ctx: UndergroundAgentContext): void;
  stop(): void;
};

export class UndergroundAgentContext {
  private readonly internalSubscribers = new Map<typeof ROOTLET_INVOCATION_REQUESTED, Set<InternalSubscription>>();

  constructor(
    readonly input: {
      readonly runtime: MinimalRuntime;
      readonly shared: UndergroundSharedContext;
      readonly intelligenceChannel?: IntelligenceChannel;
      readonly enqueue: (message: UndergroundQueuedAgentMessage) => void;
    }
  ) {}

  get runtime(): MinimalRuntime {
    return this.input.runtime;
  }

  get shared(): UndergroundSharedContext {
    return this.input.shared;
  }

  get intelligenceChannel(): IntelligenceChannel | undefined {
    return this.input.intelligenceChannel;
  }

  subscribe<TType extends ArborMessageType>(
    agentId: string,
    type: TType,
    handler: UndergroundAgentMessageHandler<ArborMessage>
  ): () => void {
    return this.input.runtime.bus.subscribe(type, (message) => {
      this.input.enqueue({
        agentId,
        message,
        handler: handler as UndergroundAgentMessageHandler<UndergroundRuntimeMessage>,
        isPublicMessage: true,
        requiresAsync: false,
      });
    });
  }

  subscribeInternal(
    agentId: string,
    type: typeof ROOTLET_INVOCATION_REQUESTED,
    handler: UndergroundAgentMessageHandler<RootletInvocationRequestedMessage>,
    options: { readonly requiresAsync?: boolean | ((message: RootletInvocationRequestedMessage) => boolean) } = {}
  ): () => void {
    const subscribers = this.internalSubscribers.get(type) ?? new Set<InternalSubscription>();
    const subscription: InternalSubscription = {
      agentId,
      handler,
      requiresAsync: options.requiresAsync ?? false,
    };
    subscribers.add(subscription);
    this.internalSubscribers.set(type, subscribers);
    return () => subscribers.delete(subscription);
  }

  publishRootletInvocationRequested(input: {
    readonly traceId: string;
    readonly goalId: string;
    readonly planId: string;
    readonly clusterId: string;
    readonly rootletKind: RootletClusterKind;
    readonly invocationId: string;
  }): void {
    const message: RootletInvocationRequestedMessage = {
      id: createId("rootlet-invocation-request"),
      type: ROOTLET_INVOCATION_REQUESTED,
      traceId: input.traceId,
      payload: {
        goalId: input.goalId,
        planId: input.planId,
        clusterId: input.clusterId,
        rootletKind: input.rootletKind,
        invocationId: input.invocationId,
      },
    };
    for (const subscription of this.internalSubscribers.get(ROOTLET_INVOCATION_REQUESTED) ?? []) {
      this.input.enqueue({
        agentId: subscription.agentId,
        message,
        handler: subscription.handler as UndergroundAgentMessageHandler<UndergroundRuntimeMessage>,
        isPublicMessage: false,
        requiresAsync: resolveRequiresAsync(subscription.requiresAsync, message),
      });
    }
  }
}

export function readPayloadRecord(
  message: Pick<ArborMessage, "type" | "payload">
): Readonly<Record<string, unknown>> {
  if (typeof message.payload !== "object" || message.payload === null || Array.isArray(message.payload)) {
    throw new UndergroundAgentRuntimeError(`${message.type} payload must be a structured object.`);
  }
  return message.payload as Readonly<Record<string, unknown>>;
}

export function readRequiredString(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string
): string {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new UndergroundAgentRuntimeError(`${eventType} payload requires string field ${key}.`);
  }
  return value;
}

export function ensureMessageFromAgent(message: ArborMessage, expectedAgentId: string): void {
  if (message.from.id !== expectedAgentId) {
    throw new UndergroundAgentRuntimeError(
      `${message.type} must be published by ${expectedAgentId}; received from ${message.from.id}.`
    );
  }
}

export function ensureMessageFromOneOf(message: ArborMessage, expectedAgentIds: readonly string[]): void {
  if (!expectedAgentIds.includes(message.from.id)) {
    throw new UndergroundAgentRuntimeError(
      `${message.type} must be published by one of [${expectedAgentIds.join(", ")}]; received from ${message.from.id}.`
    );
  }
}

export function ensurePayloadStringEquals(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  expected: string,
  eventType: string
): void {
  const value = readRequiredString(payload, key, eventType);
  if (value !== expected) {
    throw new UndergroundAgentRuntimeError(
      `${eventType} payload field ${key} must equal ${expected}; received ${value}.`
    );
  }
}

export function ensurePayloadRecordStringEquals(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  nestedKey: string,
  expected: string,
  eventType: string
): void {
  const record = readRequiredRecord(payload, key, eventType);
  ensurePayloadStringEquals(record, nestedKey, expected, eventType);
}

export function ensurePayloadRecordArrayStringIdsEqual(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  nestedKey: string,
  expected: readonly string[],
  eventType: string
): void {
  const records = readRequiredRecordArray(payload, key, eventType);
  const actual = records.map((record) => readRequiredString(record, nestedKey, eventType));
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new UndergroundAgentRuntimeError(
      `${eventType} payload field ${key}.${nestedKey} must match underground shared context.`
    );
  }
}

export function readRequiredRecord(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string
): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UndergroundAgentRuntimeError(`${eventType} payload requires object field ${key}.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

export function readRequiredRecordArray(
  payload: Readonly<Record<string, unknown>>,
  key: string,
  eventType: string
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new UndergroundAgentRuntimeError(`${eventType} payload requires array field ${key}.`);
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new UndergroundAgentRuntimeError(`${eventType} payload array ${key} must contain objects.`);
    }
    return item as Readonly<Record<string, unknown>>;
  });
}

export function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new UndergroundAgentRuntimeError(`Underground agent runtime missing ${label}.`);
  }
  return value;
}

function resolveRequiresAsync(
  requiresAsync: boolean | ((message: RootletInvocationRequestedMessage) => boolean),
  message: RootletInvocationRequestedMessage
): boolean {
  return typeof requiresAsync === "function" ? requiresAsync(message) : requiresAsync;
}
