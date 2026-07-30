import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolJsonSchema } from "../../domain/tools/index.js";
import { asOptionalRecord, asRecord, stringOrUndefined } from "../../kernel/values/index.js";
import type { AgentToolRegistryContribution } from "../tool-center/factory.js";
import { SpaceFeatureError, type SpaceFeature, type SpaceReference, type SpaceTarget } from "./contracts.js";

export type SpaceToolOptions = {
  readonly spaces: Pick<SpaceFeature, "commands" | "queries">;
};

/** All Agent-visible operations on the reference-only SpaceTree feature. */
export function createSpaceTools(options: SpaceToolOptions): readonly ToolExecutor[] {
  return [
    createSpaceListTool(options),
    createSpaceCreateTool(options),
    createSpaceMoveTool(options),
    createSpaceAddReferenceTool(options),
    createSpaceRemoveReferenceTool(options),
    createSpaceRenameTool(options),
  ];
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

export function createSpaceRemoveReferenceTool(options: SpaceToolOptions): ToolExecutor {
  return tool({
    name: "SpaceRemoveReference",
    description: "Remove a reference item from a SpaceTree. This does not delete, alter, or detach the referenced local file, artifact, web page, or Ordinary conversation.",
    metadata: writeMetadata,
    inputSchema: requiredSchema({ itemId: { type: "string" } }, ["itemId"]),
    execute: async (input) => {
      const itemId = stringOrUndefined(asRecord(input).itemId);
      if (itemId === undefined) return invalid("itemId must be a string.");
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
