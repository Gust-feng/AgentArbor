import type { ArborMessage } from "../../domain/common.js";
import { createId, nowIso } from "../id.js";

export type MessageInput<TPayload> = Omit<ArborMessage<TPayload>, "id" | "createdAt"> &
  Partial<Pick<ArborMessage<TPayload>, "id" | "createdAt">>;

export function createMessage<TPayload>(input: MessageInput<TPayload>): ArborMessage<TPayload> {
  return {
    ...input,
    id: input.id ?? createId("msg"),
    priority: input.priority ?? "normal",
    createdAt: input.createdAt ?? nowIso(),
  };
}
