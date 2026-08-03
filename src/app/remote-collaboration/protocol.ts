import { z } from "zod";

export const REMOTE_COLLABORATION_PROTOCOL_VERSION = "remote-collaboration/v1" as const;

export const remoteDeviceRoleSchema = z.enum(["desktop", "mobile"]);
export type RemoteDeviceRole = z.infer<typeof remoteDeviceRoleSchema>;

const stableIdSchema = z.string().trim().min(1).max(160);
const isoDateSchema = z.iso.datetime({ offset: true });
const fingerprintSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const MAX_SYNC_TEXT_BYTES = 512 * 1_024;

const syncTextSchema = z.string().max(MAX_SYNC_TEXT_BYTES).superRefine((value, context) => {
  if (new TextEncoder().encode(value).byteLength > MAX_SYNC_TEXT_BYTES) {
    context.addIssue({ code: "custom", message: "synchronized text must not exceed 512 KiB" });
  }
});

const snapshotPageShape = {
  snapshotId: stableIdSchema,
  pageIndex: z.number().int().nonnegative(),
  pageCount: z.number().int().positive(),
};

function validateSnapshotPage(
  value: { readonly pageIndex: number; readonly pageCount: number },
  context: z.RefinementCtx,
): void {
  if (value.pageIndex >= value.pageCount) {
    context.addIssue({ code: "custom", path: ["pageIndex"], message: "pageIndex must be less than pageCount" });
  }
}

const relativeManagedPathSchema = z.string().trim().min(1).max(512).superRefine((value, context) => {
  const normalized = value.replace(/\\/gu, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/u.test(normalized)) {
    context.addIssue({ code: "custom", message: "managed file paths must be relative" });
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    context.addIssue({ code: "custom", message: "managed file paths must not escape their managed root" });
  }
});

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

const syncableSpaceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset_folder") }).strict(),
  z.object({ kind: z.literal("workbench_asset"), assetId: stableIdSchema }).strict(),
  z.object({ kind: z.literal("managed_folder") }).strict(),
]);

export const remoteCommandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("conversation.submit"),
    commandId: stableIdSchema,
    conversationId: stableIdSchema.optional(),
    message: z.string().trim().min(1).max(64_000),
    spaceId: stableIdSchema.optional(),
  }).strict(),
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
  z.object({
    kind: z.literal("space.create"),
    commandId: stableIdSchema,
    spaceId: stableIdSchema,
    title: z.string().trim().min(1).max(160),
  }).strict(),
  z.object({
    kind: z.literal("space.reference.add"),
    commandId: stableIdSchema,
    referenceId: stableIdSchema,
    spaceId: stableIdSchema,
    parentId: stableIdSchema.optional(),
    title: z.string().trim().min(1).max(160),
    reference: syncableSpaceReferenceSchema,
  }).strict(),
  z.object({
    kind: z.literal("note.replace"),
    commandId: stableIdSchema,
    notebookId: stableIdSchema,
    expectedVersion: fingerprintSchema,
    content: z.string().max(20_000),
  }).strict(),
  z.object({
    kind: z.literal("asset.replace_text"),
    commandId: stableIdSchema,
    assetId: stableIdSchema,
    expectedFingerprint: fingerprintSchema,
    text: syncTextSchema,
  }).strict(),
  z.object({
    kind: z.literal("managed_file.replace_text"),
    commandId: stableIdSchema,
    referenceId: stableIdSchema,
    relativePath: relativeManagedPathSchema,
    expectedFingerprint: fingerprintSchema,
    text: syncTextSchema,
  }).strict(),
  z.object({
    kind: z.literal("managed_file.create_text"),
    commandId: stableIdSchema,
    referenceId: stableIdSchema,
    relativePath: relativeManagedPathSchema,
    text: syncTextSchema,
  }).strict(),
  z.object({
    kind: z.literal("sync.snapshot.request"),
    commandId: stableIdSchema,
  }).strict(),
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
  }).strict()).max(5_000),
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
}).strict();

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

const remoteSpaceSnapshotSchema = z.object({
  kind: z.literal("space.snapshot"),
  eventId: stableIdSchema,
  spaces: z.array(z.object({
    id: stableIdSchema,
    title: z.string().max(160),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
    references: z.array(z.object({
      id: stableIdSchema,
      title: z.string().max(160),
      parentId: stableIdSchema.optional(),
      reference: syncableSpaceReferenceSchema,
      createdAt: isoDateSchema,
      updatedAt: isoDateSchema,
    }).strict()).max(5_000),
  }).strict()).max(1_000),
}).strict();

const remoteNotebookSnapshotSchema = z.object({
  kind: z.literal("notebook.snapshot"),
  eventId: stableIdSchema,
  notebooks: z.array(z.object({
    notebookId: stableIdSchema,
    label: z.string().min(1).max(160),
    scope: z.enum(["global", "workspace"]),
    content: z.string().max(20_000),
    version: fingerprintSchema,
    updatedAt: isoDateSchema.optional(),
  }).strict()).max(1_000),
}).strict();

const remoteAssetSnapshotSchema = z.object({
  kind: z.literal("asset.snapshot"),
  eventId: stableIdSchema,
  ...snapshotPageShape,
  assets: z.array(z.object({
    assetId: stableIdSchema,
    title: z.string().min(1).max(500),
    kind: z.enum(["markdown", "code"]),
    text: syncTextSchema,
    language: z.string().max(80),
    fingerprint: fingerprintSchema,
  }).strict()).max(1),
}).strict().superRefine(validateSnapshotPage);

const remoteManagedFolderSnapshotSchema = z.object({
  kind: z.literal("managed_folder.snapshot"),
  eventId: stableIdSchema,
  ...snapshotPageShape,
  folders: z.array(z.object({
    referenceId: stableIdSchema,
    spaceId: stableIdSchema,
    title: z.string().min(1).max(160),
    files: z.array(z.object({
      relativePath: relativeManagedPathSchema,
      text: syncTextSchema,
      fingerprint: fingerprintSchema,
    }).strict()).max(1),
  }).strict()).max(1),
}).strict().superRefine(validateSnapshotPage);

export const remoteSyncSnapshotSchema = z.discriminatedUnion("kind", [
  remoteSpaceSnapshotSchema,
  remoteNotebookSnapshotSchema,
  remoteAssetSnapshotSchema,
  remoteManagedFolderSnapshotSchema,
]);
export type RemoteSyncSnapshot = z.infer<typeof remoteSyncSnapshotSchema>;

export const remoteEventSchema = z.discriminatedUnion("kind", [
  commandResultSchema,
  remoteConversationIndexSchema,
  remoteConversationPageSchema,
  remoteRunSnapshotSchema,
  remoteRunDeltaSchema,
  remoteSpaceSnapshotSchema,
  remoteNotebookSnapshotSchema,
  remoteAssetSnapshotSchema,
  remoteManagedFolderSnapshotSchema,
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
    code: z.literal("peer_offline"),
    message: z.string().min(1).max(4_000),
  }).strict(),
  z.object({
    protocolVersion: z.literal(REMOTE_COLLABORATION_PROTOCOL_VERSION),
    type: z.literal("peer.presence"),
    online: z.boolean(),
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

export function parseRemoteSyncSnapshot(value: unknown): RemoteSyncSnapshot {
  return remoteSyncSnapshotSchema.parse(value);
}

export function isRemoteSyncSnapshot(event: RemoteEvent): event is RemoteSyncSnapshot {
  return event.kind === "space.snapshot" || event.kind === "notebook.snapshot"
    || event.kind === "asset.snapshot" || event.kind === "managed_folder.snapshot";
}
