import path from "node:path";
import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolJsonSchema } from "../../domain/tools/index.js";
import { asOptionalRecord, asRecord, stringOrUndefined } from "../../kernel/values/index.js";
import type { TaskSoil } from "../../domain/soil/index.js";
import type { AgentToolRegistryContribution } from "../tool-center/factory.js";
import { createLocalEditFileTool, createLocalWriteFileTool } from "../tool-center/adapters/local-workspace-write-tools.js";
import type { LocalWorkspaceMutationCoordinator } from "../tool-center/adapters/local-workspace-mutation-coordinator.js";
import {
  isSpaceReferenceWritePermission,
  spaceReferenceAttachmentId,
  spaceReferenceIdFromAttachmentId,
  spaceReferenceWritePermission,
} from "./space-file-access.js";
import { SpaceFeatureError, type SpaceFeature, type SpaceReference, type SpaceTarget } from "./contracts.js";

export type SpaceToolOptions = {
  readonly spaces: Pick<SpaceFeature, "commands" | "queries">;
  readonly taskSoil?: TaskSoil;
  readonly mutationCoordinator?: LocalWorkspaceMutationCoordinator;
};

/** All Agent-visible operations on the reference-only SpaceTree feature. */
export function createSpaceTools(options: SpaceToolOptions): readonly ToolExecutor[] {
  const tools = [
    createSpaceListTool(options),
    createSpaceCreateTool(options),
    createSpaceMoveTool(options),
    createSpaceAddReferenceTool(options),
    createSpaceUnlinkReferenceTool(options),
    createSpaceRemoveReferenceTool(options),
    createSpaceRenameTool(options),
  ];
  // Snapshot assembly has no Task Soil and must catalog the definitions. At
  // execution time, omit them unless this run actually froze a Space grant.
  return options.taskSoil === undefined || hasSpaceWriteGrant(options.taskSoil)
    ? [...tools, createSpaceWriteTool(options), createSpaceEditTool(options)]
    : tools;
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

export function createSpaceMoveTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceMove",
    description: "Move a top-level reference item to another Space. Moving changes only Space metadata; it never moves the referenced filesystem object.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({
      targetKind: { type: "string", enum: ["reference"] }, targetId: { type: "string" }, destinationSpaceId: { type: "string" },
    }, ["targetKind", "targetId", "destinationSpaceId"]),
    execute: async (input) => {
      const record = asRecord(input);
      const target = movableTarget(record.targetKind, record.targetId);
      const destinationSpaceId = stringOrUndefined(record.destinationSpaceId);
      if (target === undefined || destinationSpaceId === undefined) return invalid("targetKind, targetId and destinationSpaceId are required strings.");
      return resultFor(() => options.spaces.commands.move({ target, destinationSpaceId }), () => ({ status: "moved", target, destinationSpaceId }));
    },
  });
}

export function createSpaceAddReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceAddReference",
    description: "Add an opaque reference to a local file, workspace folder, web page, generated artifact, or Ordinary conversation. This never copies the target's content or transfers its ownership.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({
      spaceId: { type: "string" }, title: { type: "string" }, reference: referenceSchema,
    }, ["spaceId", "title", "reference"]),
    execute: async (input) => {
      const record = asRecord(input);
      const spaceId = stringOrUndefined(record.spaceId);
      const title = stringOrUndefined(record.title);
      const reference = referenceFromUnknown(record.reference);
      if (spaceId === undefined || title === undefined || reference === undefined) return invalid("spaceId, title and a valid reference are required.");
      return resultFor(() => options.spaces.commands.addReference({ spaceId, title, reference }), (item) => ({ status: "added", item }));
    },
  });
}

export function createSpaceUnlinkReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceUnlinkReference",
    description: "Remove a Space metadata link while preserving the referenced file, folder, web page, artifact, or conversation source.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({ itemId: { type: "string" } }, ["itemId"]),
    execute: async (input) => {
      const itemId = stringOrUndefined(asRecord(input).itemId);
      if (itemId === undefined) return invalid("itemId must be a string.");
      return resultFor(() => options.spaces.commands.unlinkReference(itemId), () => ({ status: "unlinked", itemId }));
    },
  });
}

export function createSpaceRemoveReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceRemoveReference",
    description: "Physically delete a referenced local file or AgentArbor-managed folder and remove its Space metadata. Use SpaceUnlinkReference when the source must be preserved; external workspace folders cannot be deleted by this tool.",
    metadata: destructiveMetadata,
    inputSchema: requiredSchema({ itemId: { type: "string" } }, ["itemId"]),
    execute: async (input) => {
      const itemId = stringOrUndefined(asRecord(input).itemId);
      if (itemId === undefined) return invalid("itemId must be a string.");
      const item = await options.spaces.queries.getReference(itemId);
      if (item === undefined) return { status: "space_reference_not_found", itemId };
      if (item.reference.kind !== "local_file" && item.reference.kind !== "managed_folder") {
        return {
          status: "reference_delete_unavailable",
          itemId,
          referenceKind: item.reference.kind,
          message: "This reference can only be unlinked; its source cannot be deleted by SpaceRemoveReference.",
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
      return resultFor(() => options.spaces.commands.rename({ target, title }), () => ({ status: "renamed", target, title }));
    },
  });
}

export function createSpaceWriteTool(options: SpaceToolOptions): ToolExecutor {
  return {
    definition: {
      name: "SpaceWrite",
      description: "Create or completely rewrite a UTF-8 text file inside a local file or folder reference frozen for the current conversation Space. Select the resource by referenceId; raw absolute paths are not accepted.",
      metadata: fileWriteMetadata,
      inputSchema: requiredSchema({
        referenceId: { type: "string", minLength: 1, description: "SpaceList reference id or the full space-reference attachment id." },
        path: { type: "string", minLength: 1, description: "Folder-relative file path. Omit for a single-file reference." },
        content: { type: "string", description: "Complete UTF-8 text content." },
      }, ["referenceId", "content"]),
    },
    execute: async (input, context) => {
      const record = asRecord(input);
      const referenceId = normalizedReferenceId(record.referenceId);
      if (referenceId === undefined || typeof record.content !== "string") {
        return invalid("referenceId and string content are required.");
      }
      const target = resolveSpaceFileTarget(options.taskSoil, referenceId, optionalString(record.path));
      const result = await createLocalWriteFileTool(target.rootPath, {
        mutationCoordinator: options.mutationCoordinator,
      }).execute({ path: target.relativePath, content: record.content }, context);
      return result;
    },
  };
}

export function createSpaceEditTool(options: SpaceToolOptions): ToolExecutor {
  return {
    definition: {
      name: "SpaceEdit",
      description: "Replace exact text in one UTF-8 file inside a local file or folder reference frozen for the current conversation Space. Every oldText must match exactly once.",
      metadata: fileWriteMetadata,
      inputSchema: requiredSchema({
        referenceId: { type: "string", minLength: 1, description: "SpaceList reference id or the full space-reference attachment id." },
        path: { type: "string", minLength: 1, description: "Folder-relative file path. Omit for a single-file reference." },
        edits: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              oldText: { type: "string", minLength: 1 },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
            additionalProperties: false,
          },
        },
      }, ["referenceId", "edits"]),
    },
    execute: async (input, context) => {
      const record = asRecord(input);
      const referenceId = normalizedReferenceId(record.referenceId);
      if (referenceId === undefined || !Array.isArray(record.edits)) {
        return invalid("referenceId and edits are required.");
      }
      const target = resolveSpaceFileTarget(options.taskSoil, referenceId, optionalString(record.path));
      const result = await createLocalEditFileTool(target.rootPath, {
        mutationCoordinator: options.mutationCoordinator,
      }).execute({ path: target.relativePath, edits: record.edits }, context);
      return result;
    },
  };
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
const fileWriteMetadata = { category: "filesystem", riskLevel: "medium", operationType: "read-write", requiresConfirmation: false } as const;

function requiredSchema(properties: ToolDefinition["inputSchema"]["properties"], required: readonly string[]): ToolDefinition["inputSchema"] {
  return { type: "object" as const, properties, required };
}

const referenceSchema: ToolJsonSchema = {
  type: "object",
  oneOf: [
    { type: "object", properties: { kind: { const: "local_file" }, path: { type: "string" } }, required: ["kind", "path"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "workspace_folder" }, path: { type: "string" } }, required: ["kind", "path"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "web_page" }, url: { type: "string", format: "uri" } }, required: ["kind", "url"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "generated_artifact" }, artifactRef: { type: "string" } }, required: ["kind", "artifactRef"], additionalProperties: false },
    { type: "object", properties: { kind: { const: "conversation" }, conversationId: { type: "string" }, conversationTitle: { type: "string" } }, required: ["kind", "conversationId"], additionalProperties: false },
  ],
};

function invalid(message: string) { return { status: "invalid_input", message }; }
function optionalString(value: unknown): string | undefined | null { return value === undefined ? undefined : stringOrUndefined(value) ?? null; }

function resolveSpaceFileTarget(
  taskSoil: TaskSoil | undefined,
  referenceId: string,
  requestedPath: string | undefined | null,
): { readonly rootPath: string; readonly relativePath: string } {
  if (requestedPath === null) throw new Error("path must be a string when provided.");
  if (taskSoil === undefined || !taskSoil.permissionBoundaryRefs.includes(spaceReferenceWritePermission(referenceId))) {
    throw new Error(`Space reference ${referenceId} is not writable in this run.`);
  }
  const contextRef = taskSoil.contextRefs.find((ref) => ref.attachmentId === spaceReferenceAttachmentId(referenceId));
  if (contextRef?.kind === "file" && contextRef.ref.startsWith("local-file:")) {
    if (requestedPath !== undefined && requestedPath !== ".") {
      throw new Error("A single-file Space reference does not accept a nested path.");
    }
    const absolutePath = path.resolve(contextRef.ref.slice("local-file:".length));
    return { rootPath: path.dirname(absolutePath), relativePath: path.basename(absolutePath) };
  }
  if (contextRef?.kind === "project" && contextRef.ref.startsWith("local-project:")) {
    if (requestedPath === undefined || requestedPath === ".") {
      throw new Error("A folder Space reference requires a relative file path.");
    }
    return {
      rootPath: path.resolve(contextRef.ref.slice("local-project:".length)),
      relativePath: requestedPath,
    };
  }
  throw new Error(`Space reference ${referenceId} has no frozen local file grant.`);
}

function hasSpaceWriteGrant(taskSoil: TaskSoil): boolean {
  return taskSoil.permissionBoundaryRefs.some(isSpaceReferenceWritePermission);
}

function normalizedReferenceId(value: unknown): string | undefined {
  const selector = stringOrUndefined(value);
  return selector === undefined ? undefined : spaceReferenceIdFromAttachmentId(selector) ?? selector;
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

function referenceFromUnknown(value: unknown): SpaceReference | undefined {
  const record = asOptionalRecord(value);
  if (record === undefined) return undefined;
  const kind = stringOrUndefined(record.kind);
  if ((kind === "local_file" || kind === "workspace_folder") && stringOrUndefined(record.path) !== undefined) return { kind, path: stringOrUndefined(record.path)! };
  if (kind === "web_page" && stringOrUndefined(record.url) !== undefined) return { kind, url: stringOrUndefined(record.url)! };
  if (kind === "generated_artifact" && stringOrUndefined(record.artifactRef) !== undefined) return { kind, artifactRef: stringOrUndefined(record.artifactRef)! };
  if (kind === "conversation" && stringOrUndefined(record.conversationId) !== undefined) {
    const conversationTitle = optionalString(record.conversationTitle);
    if (conversationTitle === null) return undefined;
    return { kind, conversationId: stringOrUndefined(record.conversationId)!, conversationTitle };
  }
  return undefined;
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
  return code === "space_not_found" || code === "space_reference_not_found" || code === "space_invalid_move" || code === "space_invalid_input" || code === "space_id_collision";
}
