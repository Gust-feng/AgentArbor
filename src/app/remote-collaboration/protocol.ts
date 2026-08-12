import { z } from "zod";

export const REMOTE_COLLABORATION_PROTOCOL_VERSION = "remote-collaboration/v1" as const;
export const REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES = 6 * 1_024 * 1_024;

export const remoteDeviceRoleSchema = z.enum(["desktop", "mobile"]);
export type RemoteDeviceRole = z.infer<typeof remoteDeviceRoleSchema>;

const stableIdSchema = z.string().trim().min(1).max(160);
const isoDateSchema = z.iso.datetime({ offset: true });

const confirmationDecisionSchema = z.object({
  runId: stableIdSchema,
  confirmationId: stableIdSchema,
  decision: z.enum(["approve_once", "deny", "guidance"]),
  guidance: z.string().trim().min(1).max(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "guidance" && value.guidance === undefined) {
    context.addIssue({ code: "custom", path: ["guidance"], message: "guidance is required for a guidance decision" });
  }
});

export const remoteCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversation.submit"),
    commandId: stableIdSchema,
    conversationId: stableIdSchema.optional(),
    message: z.string().trim().min(1).max(64_000),
    spaceId: stableIdSchema.optional(),
    modelSelectionId: stableIdSchema.optional(),
  }).strict().superRefine((value, context) => {
    if (value.conversationId === undefined && value.spaceId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["spaceId"],
        message: "spaceId is required when creating a conversation",
      });
    }
  }),
  z.object({
    kind: z.literal("conversation.page.request"),
    commandId: stableIdSchema,
    conversationId: stableIdSchema,
    beforeTurnId: stableIdSchema.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }).strict(),
  z.object({
    kind: z.literal("run.cancel"),
    commandId: stableIdSchema,
    runId: stableIdSchema,
  }).strict(),
  z.object({
    kind: z.literal("confirmation.decide"),
    commandId: stableIdSchema,
    ...confirmationDecisionSchema.shape,
  }).strict().superRefine((value, context) => {
    if (value.decision === "guidance" && value.guidance === undefined) {
      context.addIssue({ code: "custom", path: ["guidance"], message: "guidance is required for a guidance decision" });
    }
  }),
]);
export type RemoteCommand = z.infer<typeof remoteCommandSchema>;

const commandResultSchema = z.object({
  kind: z.literal("command.result"),
  eventId: stableIdSchema,
  commandId: stableIdSchema,
  status: z.enum(["applied", "conflict", "failed"]),
  entity: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: stableIdSchema, message: z.string().min(1).max(4_000) }).strict().optional(),
}).strict();

const remoteConfirmationSchema = z.object({
  confirmationId: stableIdSchema,
  title: z.string().min(1).max(500),
  actionSummary: z.string().min(1).max(4_000),
  consequence: z.string().max(4_000).optional(),
  affectedResources: z.array(z.string().max(2_000)).max(100),
  riskLevel: z.enum(["low", "medium", "high"]),
  resumeAvailability: z.enum(["live", "lost_after_restart"]).optional(),
  requestedAt: isoDateSchema,
  expiresAt: isoDateSchema.optional(),
}).strict();

const conversationStatusSchema = z.enum([
  "idle", "queued", "running", "awaiting_approval", "completed", "failed", "cancelled", "blocked",
]);

const remoteConversationIndexSchema = z.object({
  kind: z.literal("conversation.index"),
  eventId: stableIdSchema,
  conversations: z.array(z.object({
    conversationId: stableIdSchema,
    title: z.string().max(500),
    updatedAt: isoDateSchema,
    status: conversationStatusSchema,
    activeRunId: stableIdSchema.optional(),
    spaceId: stableIdSchema.optional(),
  }).strict()).max(5_000),
  modelOptions: z.array(z.object({
    id: stableIdSchema,
    label: z.string().min(1).max(200),
    providerLabel: z.string().max(200).optional(),
    supportsTools: z.boolean(),
    supportsVision: z.boolean(),
    isDefault: z.boolean(),
  }).strict()).max(256).optional(),
}).strict();

const remoteConversationPageSchema = z.object({
  kind: z.literal("conversation.page"),
  eventId: stableIdSchema,
  conversationId: stableIdSchema,
  beforeTurnId: stableIdSchema.optional(),
  turns: z.array(z.object({
    turnId: stableIdSchema,
    runId: stableIdSchema,
    role: z.enum(["user", "assistant"]),
    content: z.string().max(1_000_000),
    status: z.enum(["pending", "queued", "running", "awaiting_approval", "completed", "failed", "cancelled", "blocked"]),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  }).strict()).max(50),
  hasMore: z.boolean(),
  nextBeforeTurnId: stableIdSchema.optional(),
}).strict().superRefine((value, context) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > REMOTE_CONVERSATION_PAGE_MAX_JSON_BYTES) {
    context.addIssue({ code: "custom", message: "conversation page exceeds the serialized byte limit" });
  }
});

const remoteRunSnapshotSchema = z.object({
  kind: z.literal("run.snapshot"),
  eventId: stableIdSchema,
  runId: stableIdSchema,
  conversationId: stableIdSchema,
  status: z.enum(["queued", "running", "awaiting_approval", "completed", "failed", "cancelled", "blocked"]),
  visibleAssistantText: z.string().max(1_000_000).optional(),
  pendingConfirmations: z.array(remoteConfirmationSchema).max(32),
  updatedAt: isoDateSchema,
}).strict();

const remoteRunDeltaSchema = z.object({
  kind: z.literal("run.delta"),
  eventId: stableIdSchema,
  runId: stableIdSchema,
  activitySequence: z.number().int().positive(),
  delta: z.string().min(1).max(262_144),
}).strict();

export const remoteEventSchema = z.discriminatedUnion("kind", [
  commandResultSchema,
  remoteConversationIndexSchema,
  remoteConversationPageSchema,
  remoteRunSnapshotSchema,
  remoteRunDeltaSchema,
]);
export type RemoteEvent = z.infer<typeof remoteEventSchema>;

export const remoteMessageContentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("command"), command: remoteCommandSchema }).strict(),
  z.object({ type: z.literal("event"), event: remoteEventSchema }).strict(),
]);
export type RemoteMessageContent = z.infer<typeof remoteMessageContentSchema>;

export const remoteRelayMessageSchema = z.object({
  protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
  messageId: stableIdSchema,
  clientMessageId: stableIdSchema,
  sourceDeviceId: stableIdSchema,
  targetDeviceId: stableIdSchema,
  createdAt: isoDateSchema,
  content: remoteMessageContentSchema,
}).strict();
export type RemoteRelayMessage = z.infer<typeof remoteRelayMessageSchema>;

export const remoteClientFrameSchema = z.discriminatedUnion("type", [
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("client.hello"),
    token: z.string().min(32).max(512),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.submit"),
    clientMessageId: stableIdSchema,
    content: remoteMessageContentSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.received"),
    messageId: stableIdSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("heartbeat"),
    sentAt: isoDateSchema,
  }).strict(),
]);
export type RemoteClientFrame = z.infer<typeof remoteClientFrameSchema>;

export const remoteServerFrameSchema = z.discriminatedUnion("type", [
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("server.ready"),
    deviceId: stableIdSchema,
    peerDeviceId: stableIdSchema.optional(),
    peerDeviceName: z.string().min(1).max(160).optional(),
    peerOnline: z.boolean(),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.accepted"),
    clientMessageId: stableIdSchema,
    messageId: stableIdSchema,
    settled: z.boolean(),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.received"),
    clientMessageId: stableIdSchema,
    messageId: stableIdSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.rejected"),
    clientMessageId: stableIdSchema,
    code: z.enum(["peer_offline", "peer_backpressure"]),
    message: z.string().min(1).max(4_000),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("peer.presence"),
    online: z.boolean(),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("vault.changed"),
    cursor: z.number().int().positive(),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("message.deliver"),
    message: remoteRelayMessageSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("heartbeat.ack"),
    sentAt: isoDateSchema,
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("server.error"),
    code: stableIdSchema,
    message: z.string().min(1).max(4_000),
  }).strict(),
]);
export type RemoteServerFrame = z.infer<typeof remoteServerFrameSchema>;

export function parseRemoteClientFrame(value: unknown): RemoteClientFrame {
  return remoteClientFrameSchema.parse(value);
}

export function parseRemoteMessageContent(value: unknown): RemoteMessageContent {
  return remoteMessageContentSchema.parse(value);
}
