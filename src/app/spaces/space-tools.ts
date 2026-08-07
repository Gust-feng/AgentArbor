import path from "node:path";
import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolJsonSchema } from "../../domain/tools/index.js";
import { asOptionalRecord, asRecord, stringOrUndefined } from "../../kernel/values/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { AgentToolRegistryContribution } from "../tool-center/factory.js";
import {
  attachmentEntries,
  resolveAttachmentTarget,
} from "../tool-center/adapters/context-attachment-access.js";
import {
  spaceReferenceIdFromAttachmentId,
} from "./space-file-access.js";
import { SpaceFeatureError, type SpaceAddableReference, type SpaceFeature, type SpaceReference, type SpaceTarget } from "./contracts.js";

export type SpaceToolOptions = {
  readonly spaces: Pick<SpaceFeature, "commands" | "queries">;
  readonly workspaceRoot: string;
  readonly taskSoil?: TaskSoil;
  /** Host deletion-coordinator admission check for Space-scoped writes. */
  readonly assertSpaceAvailable?: (spaceId: string) => void;
  /** Host-owned durable Space deletion workflow. */
  readonly deleteSpace?: (spaceId: string) => Promise<void>;
  /** Host-owned durable Conversation deletion workflow. */
  readonly deleteConversation?: (conversationId: string) => Promise<void>;
  /** Revocations observed since this run froze its grants. */
  readonly revocationOverlay?: SpaceRevocationOverlay;
};

/** All Agent-visible operations on the reference-only SpaceTree feature. */
export function createSpaceTools(options: SpaceToolOptions): readonly ToolExecutor[] {
  const tools = [
    createSpaceListTool(options),
    createSpaceCreateTool(options),
    createSpaceDeleteTool(options),
    createConversationDeleteTool(options),
    createSpaceMoveTool(options),
    createSpaceAddReferenceTool(options),
    createSpaceUnlinkReferenceTool(options),
    createSpaceRemoveReferenceTool(options),
    createSpaceRenameTool(options),
  ];
  // File I/O stays on the mature Read/Glob/Grep/Write/Edit executors. The Host
  // injects Space path authority into those tools, avoiding a second file API.
  return tools;
}

/** Host-selected contribution; it does not create a registry or make visibility decisions. */
export function createSpaceToolRegistryContribution(options: SpaceToolOptions): AgentToolRegistryContribution {
  return (register) => {
    for (const executor of createSpaceTools(options)) {
      register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });
    }
  };
}

export function createSpaceListTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceList",
    description: "List the user's Spaces and their folder/reference counts, or read one SpaceTree when spaceId is provided. External files and conversations are returned only as stored references.",
    metadata: readMetadata,
    inputSchema: { type: "object", properties: { spaceId: { type: "string", description: "Optional Space id to read as a tree." } } },
    execute: async (input) => {
      const spaceId = stringOrUndefined(asRecord(input).spaceId);
      if (spaceId === undefined) return { status: "listed", spaces: await options.spaces.queries.list() };
      const tree = await options.spaces.queries.getTree(spaceId);
      return tree === undefined ? { status: "space_not_found", spaceId } : { status: "found", tree };
    },
  });
}

export function createSpaceCreateTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceCreate",
    description: "Create an empty top-level Space for organizing references. It does not create a local directory or external resource.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({ title: { type: "string", description: "Visible Space title." } }, ["title"]),
    execute: async (input) => {
      const title = stringOrUndefined(asRecord(input).title);
      if (title === undefined) return invalid("title must be a string.");
      return resultFor(() => options.spaces.commands.createSpace({ title }), (space) => ({ status: "created", space }));
    },
  });
}

export function createSpaceDeleteTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceDelete",
    description: "Delete a Space and its Space-owned materials and Conversations. External files and folders are only unlinked; their source content is preserved.",
    metadata: destructiveMetadata,
    inputSchema: requiredSchema({ spaceId: { type: "string", minLength: 1 } }, ["spaceId"]),
    execute: async (input) => {
      const spaceId = stringOrUndefined(asRecord(input).spaceId);
      if (spaceId === undefined) return invalid("spaceId must be a string.");
      options.assertSpaceAvailable?.(spaceId);
      if (options.deleteSpace === undefined) return { status: "space_delete_unavailable", spaceId, message: "The Host Space deletion coordinator is not available." };
      return resultFor(() => options.deleteSpace!(spaceId), () => ({ status: "deleted", spaceId }));
    },
  });
}

export function createConversationDeleteTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "ConversationDelete",
    description: "Delete a Conversation and its Space owner link. This is irreversible for the Conversation history and requires confirmation.",
    metadata: destructiveMetadata,
    inputSchema: requiredSchema({ conversationId: { type: "string", minLength: 1 } }, ["conversationId"]),
    execute: async (input) => {
      const conversationId = stringOrUndefined(asRecord(input).conversationId);
      if (conversationId === undefined) return invalid("conversationId must be a string.");
      if (options.deleteConversation === undefined) return { status: "conversation_delete_unavailable", conversationId, message: "The Host Conversation deletion coordinator is not available." };
      return resultFor(() => options.deleteConversation!(conversationId), () => ({ status: "deleted", conversationId }));
    },
  });
}

export function createSpaceMoveTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceMove",
    description: "Move a Space-owned material to another Space. External file/folder references and Conversation owners cannot be moved; web pages and generated artifacts may retain metadata-only moves.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({
      targetKind: { type: "string", enum: ["reference"] }, targetId: { type: "string" }, destinationSpaceId: { type: "string" },
    }, ["targetKind", "targetId", "destinationSpaceId"]),
    execute: async (input) => {
      const record = asRecord(input);
      const target = movableTarget(record.targetKind, record.targetId);
      const destinationSpaceId = stringOrUndefined(record.destinationSpaceId);
      if (target === undefined || destinationSpaceId === undefined) return invalid("targetKind, targetId and destinationSpaceId are required strings.");
      const item = await options.spaces.queries.getReference(target.id);
      if (item === undefined) return { status: "space_reference_not_found", itemId: target.id };
      options.assertSpaceAvailable?.(item.spaceId);
      options.assertSpaceAvailable?.(destinationSpaceId);
      if (!isMovableSpaceMaterial(item.reference)) {
        return {
          status: "space_reference_move_unavailable",
          itemId: target.id,
          referenceKind: item.reference.kind,
          message: "External file/folder references and Conversation owners cannot be moved.",
        };
      }
      return resultFor(() => options.spaces.commands.move({ target, destinationSpaceId }), () => ({ status: "moved", target, destinationSpaceId }));
    },
  });
}

export function createSpaceAddReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceAddReference",
    description: "Add an external file/folder reference or Space material from the current Task Soil attachment. Select local files and folders by attachmentId from AttachmentList; raw local paths are not accepted. Conversation owners are created only by the conversation workflow.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({
      spaceId: { type: "string" }, title: { type: "string" }, reference: referenceSchema,
    }, ["spaceId", "title", "reference"]),
    execute: async (input) => {
      const record = asRecord(input);
      const spaceId = stringOrUndefined(record.spaceId);
      const title = stringOrUndefined(record.title);
      if (spaceId === undefined || title === undefined) return invalid("spaceId, title and a valid reference are required.");
      options.assertSpaceAvailable?.(spaceId);
      const resolution = await resolveAgentSpaceReference(record.reference, options);
      if ("error" in resolution) return resolution.error;
      return resultFor(() => options.spaces.commands.addReference({ spaceId, title, reference: resolution.reference }), (item) => ({ status: "added", item }));
    },
  });
}

export function createSpaceUnlinkReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceUnlinkReference",
    description: "Remove an external file, folder, web page, or generated artifact reference while preserving its source. Space-owned materials and Conversation owners use their own deletion workflows.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({ itemId: { type: "string" } }, ["itemId"]),
    execute: async (input) => {
      const itemId = stringOrUndefined(asRecord(input).itemId);
      if (itemId === undefined) return invalid("itemId must be a string.");
      const item = await options.spaces.queries.getReference(itemId);
      if (item === undefined) return { status: "space_reference_not_found", itemId };
      options.assertSpaceAvailable?.(item.spaceId);
      if (!isExternalReference(item.reference)) {
        return {
          status: item.reference.kind === "conversation" ? "space_conversation_owner_immutable" : "space_reference_unlink_unavailable",
          itemId,
          referenceKind: item.reference.kind,
          message: item.reference.kind === "conversation"
            ? "Conversation ownership can only be changed by creating or deleting the Conversation."
            : "Space-owned materials must be deleted through their material workflow.",
        };
      }
      return resultFor(() => options.spaces.commands.unlinkReference(itemId), () => ({ status: "unlinked", itemId }));
    },
  });
}

export function createSpaceRemoveReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceRemoveReference",
    description: "Delete a Space-owned material and remove its Space metadata. External files, folders, web pages, generated artifacts, and Conversation owners cannot be physically deleted by this tool.",
    metadata: destructiveMetadata,
    inputSchema: requiredSchema({ itemId: { type: "string" } }, ["itemId"]),
    execute: async (input) => {
      const itemId = stringOrUndefined(asRecord(input).itemId);
      if (itemId === undefined) return invalid("itemId must be a string.");
      const item = await options.spaces.queries.getReference(itemId);
      if (item === undefined) return { status: "space_reference_not_found", itemId };
      options.assertSpaceAvailable?.(item.spaceId);
      if (!isSpaceOwnedMaterial(item.reference)) {
        return {
          status: "reference_delete_unavailable",
          itemId,
          referenceKind: item.reference.kind,
          message: item.reference.kind === "conversation"
            ? "Conversation owners can only be removed by deleting the Conversation."
            : "This external reference can only be unlinked; its source cannot be deleted by SpaceRemoveReference.",
        };
      }
      return resultFor(() => options.spaces.commands.removeReference(itemId), () => ({ status: "removed", itemId }));
    },
  });
}

export function createSpaceRenameTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceRename",
    description: "Rename a Space or a top-level reference display label. It does not rename the referenced filesystem object.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({ targetKind: { type: "string", enum: ["space", "reference"] }, targetId: { type: "string" }, title: { type: "string" } }, ["targetKind", "targetId", "title"]),
    execute: async (input) => {
      const record = asRecord(input);
      const target = targetFrom(record.targetKind, record.targetId);
      const title = stringOrUndefined(record.title);
      if (target === undefined || title === undefined) return invalid("targetKind, targetId and title must be strings.");
      if (target.kind === "space") {
        options.assertSpaceAvailable?.(target.id);
      } else {
        const item = await options.spaces.queries.getReference(target.id);
        if (item === undefined) return { status: "space_reference_not_found", itemId: target.id };
        options.assertSpaceAvailable?.(item.spaceId);
        if (item.reference.kind === "conversation") {
          return { status: "space_conversation_owner_immutable", itemId: target.id, message: "Conversation ownership cannot be renamed as a generic Space reference." };
        }
      }
      return resultFor(() => options.spaces.commands.rename({ target, title }), () => ({ status: "renamed", target, title }));
    },
  });
}

type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly metadata: NonNullable<ToolDefinition["metadata"]>;
  readonly inputSchema: ToolDefinition["inputSchema"];
  readonly execute: (input: unknown) => Promise<unknown>;
};
function tool(spec: ToolSpec): ToolExecutor {
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
      inputSchema: spec.inputSchema,
    },
    execute: (input: unknown, _context: ToolExecutionContext) => spec.execute(input),
  };
}

const readMetadata = { category: "workspace", riskLevel: "low", operationType: "read-only", requiresConfirmation: false } as const;
const writeMetadata = { category: "workspace", riskLevel: "low", operationType: "read-write", requiresConfirmation: false } as const;
const destructiveMetadata = { category: "workspace", riskLevel: "high", operationType: "read-write", requiresConfirmation: true, fileOperation: "delete" } as const;

function requiredSchema(properties: ToolDefinition["inputSchema"]["properties"], required: readonly string[]): ToolDefinition["inputSchema"] {
  return { type: "object" as const, properties, required };
}

const referenceSchema: ToolJsonSchema = {
  type: "object",
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "local_attachment" },
        attachmentId: { type: "string", minLength: 1, description: "Current Task Soil attachment id returned by AttachmentList." },
      },
      required: ["kind", "attachmentId"],
      additionalProperties: false,
    },
    { type: "object", properties: { kind: { const: "web_page" }, url: { type: "string", format: "uri" } }, required: ["kind", "url"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "generated_artifact" }, artifactRef: { type: "string" } }, required: ["kind", "artifactRef"], additionalProperties: false },
  ],
};

function invalid(message: string) { return { status: "invalid_input", message }; }

/**
 * Deny set layered over the run's frozen grants. It records only references
 * observed being revoked, because "absent from this Space" cannot distinguish a
 * revoked reference from one that was never there, and denying on absence alone
 * would reject legitimate writes.
 */
export type SpaceRevocationOverlay = {
  has(referenceId: string): boolean;
  assertReadAllowed(attachmentId: string): void;
};

/** Accumulates live revocations so in-flight runs cannot reuse removed references. */
export function createSpaceRevocationOverlay(
  events: Pick<SpaceFeature, "events">["events"],
): SpaceRevocationOverlay & { dispose(): void } {
  const revoked = new Set<string>();
  const unsubscribe = events.subscribe((event) => {
    if (event.type === "space.reference_removed") {
      revoked.add(event.itemId);
      for (const id of event.removedItemIds) revoked.add(id);
    } else if (event.type === "space.deleted") {
      for (const id of event.removedReferenceIds) revoked.add(id);
    }
  });
  return {
    has: (referenceId) => revoked.has(referenceId),
    assertReadAllowed(attachmentId) {
      const referenceId = spaceReferenceIdFromAttachmentId(attachmentId);
      if (referenceId !== undefined && revoked.has(referenceId)) {
        throw new Error(`Space reference ${referenceId} was revoked and is no longer readable.`);
      }
    },
    dispose: unsubscribe,
  };
}

function targetFrom(kind: unknown, id: unknown): SpaceTarget | undefined {
  const targetKind = stringOrUndefined(kind);
  const targetId = stringOrUndefined(id);
  if (targetId === undefined || (targetKind !== "space" && targetKind !== "reference")) return undefined;
  return { kind: targetKind, id: targetId };
}

function movableTarget(kind: unknown, id: unknown): { readonly kind: "reference"; readonly id: string } | undefined {
  const target = targetFrom(kind, id);
  return target?.kind === "reference" ? { kind: "reference", id: target.id } : undefined;
}

type AgentSpaceReferenceResolution =
  | { readonly reference: SpaceAddableReference }
  | { readonly error: Readonly<Record<string, unknown>> };

async function resolveAgentSpaceReference(
  value: unknown,
  options: SpaceToolOptions,
): Promise<AgentSpaceReferenceResolution> {
  const record = asOptionalRecord(value);
  if (record === undefined) return { error: invalid("spaceId, title and a valid reference are required.") };
  const kind = stringOrUndefined(record.kind);
  if (kind === "local_attachment") {
    const attachmentId = stringOrUndefined(record.attachmentId);
    if (attachmentId === undefined) return { error: invalid("local_attachment requires attachmentId from AttachmentList.") };
    const attachment = attachmentEntries(options.taskSoil).find((entry) => entry.attachmentId === attachmentId);
    if (attachment === undefined) {
      return {
        error: {
          status: "space_reference_attachment_not_found",
          attachmentId,
          message: "No current Task Soil attachment matched this attachmentId.",
        },
      };
    }
    if (!attachment.authorized) {
      return {
        error: {
          status: "space_reference_attachment_not_authorized",
          attachmentId,
          message: "The selected attachment is not authorized for reading in this run.",
        },
      };
    }
    try {
      const target = await resolveAttachmentTarget({
        entry: attachment,
        workspaceRoot: options.workspaceRoot,
        requireFile: false,
        projectPathRequired: false,
      });
      return {
        reference: target.rootKind === "file"
          ? { kind: "local_file", path: target.rootAbsolutePath }
          : { kind: "workspace_folder", path: target.rootAbsolutePath },
      };
    } catch (error) {
      return {
        error: {
          status: "space_reference_attachment_unsupported",
          attachmentId,
          message: error instanceof Error ? error.message : "The selected attachment is not a local file or folder.",
        },
      };
    }
  }
  if (kind === "web_page" && stringOrUndefined(record.url) !== undefined) return { reference: { kind, url: stringOrUndefined(record.url)! } };
  if (kind === "generated_artifact" && stringOrUndefined(record.artifactRef) !== undefined) return { reference: { kind, artifactRef: stringOrUndefined(record.artifactRef)! } };
  return { error: invalid("spaceId, title and a valid reference are required.") };
}

function isExternalReference(reference: SpaceReference): boolean {
  return reference.kind === "local_file" ||
    reference.kind === "workspace_folder" ||
    reference.kind === "web_page" ||
    reference.kind === "generated_artifact";
}

function isSpaceOwnedMaterial(reference: SpaceReference): boolean {
  return !isExternalReference(reference) && reference.kind !== "conversation";
}

function isMovableSpaceMaterial(reference: SpaceReference): boolean {
  return reference.kind !== "local_file" && reference.kind !== "workspace_folder" && reference.kind !== "conversation";
}

async function resultFor<T>(operation: () => Promise<T>, project: (value: T) => unknown): Promise<unknown> {
  try {
    return project(await operation());
  } catch (error) {
    if (error instanceof SpaceFeatureError && isExpectedSpaceOperationError(error.code)) {
      return { status: error.code, message: error.message };
    }
    throw error;
  }
}

function isExpectedSpaceOperationError(code: SpaceFeatureError["code"]): boolean {
  return code === "space_not_found"
    || code === "space_reference_not_found"
    || code === "space_invalid_move"
    || code === "space_invalid_input"
    || code === "space_id_collision"
    || code === "space_workspace_mount_conflict"
    || code === "space_asset_ownership_conflict"
    || code === "space_conversation_ownership_conflict";
}
