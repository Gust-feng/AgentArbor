import type { ToolDefinition, ToolExecutionContext, ToolExecutor } from "../../domain/tools/index.js";
import { asRecord, numberOrUndefined, stringOrUndefined } from "../../kernel/values/index.js";
import type { AgentToolRegistryContribution } from "../tool-center/factory.js";
import { PersonalKnowledgeError, type KnowledgePage, type PersonalKnowledgeFeature } from "./contracts.js";

export type PersonalKnowledgeToolOptions = {
  readonly knowledge: Pick<PersonalKnowledgeFeature, "commands" | "queries">;
};

export function createPersonalKnowledgeTools(options: PersonalKnowledgeToolOptions): readonly ToolExecutor[] {
  return [
    createKnowledgeSearchTool(options),
    createKnowledgeReadTool(options),
    createKnowledgeCreateNoteTool(options),
    createKnowledgeUpdateNoteTool(options),
    createKnowledgeDeleteNoteTool(options),
    createKnowledgeCollectTool(options),
  ];
}

export function createPersonalKnowledgeToolRegistryContribution(
  options: PersonalKnowledgeToolOptions,
): AgentToolRegistryContribution {
  return (register) => {
    for (const executor of createPersonalKnowledgeTools(options)) {
      register({ executor, scopes: ["desktop-basic"], enabledByDefault: true });
    }
  };
}

export function createKnowledgeSearchTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeSearch",
    description: "Search the user's persisted personal Markdown notes by title and body. Results include stable note ids, Space ids, revision facts, and bounded matching snippets.",
    metadata: readMetadata,
    inputSchema: schema({
      query: { type: "string", description: "Required search text." },
      spaceId: { type: "string", description: "Optional Space id filter." },
      limit: { type: "number", description: "Optional result limit from 1 to 100. Defaults to 20." },
    }, ["query"]),
    execute: async (input) => {
      const record = asRecord(input);
      const query = stringOrUndefined(record.query);
      const spaceId = optionalString(record.spaceId);
      const limit = optionalInteger(record.limit);
      if (query === undefined || spaceId === null || limit === null) {
        return invalid("query must be a string; spaceId and limit must be omitted or valid values.");
      }
      return resultFor(
        () => options.knowledge.queries.search({ query, spaceId, limit }),
        (results) => ({ status: "found", count: results.length, results }),
      );
    },
  });
}

export function createKnowledgeReadTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeRead",
    description: "Read one persisted personal Markdown note by its stable note id, including its current revision and material reference ids.",
    metadata: readMetadata,
    inputSchema: schema({ noteId: { type: "string" } }, ["noteId"]),
    execute: async (input) => {
      const noteId = stringOrUndefined(asRecord(input).noteId);
      if (noteId === undefined) return invalid("noteId must be a string.");
      const note = await options.knowledge.queries.note(noteId);
      return note === undefined ? { status: "personal_note_not_found", noteId } : { status: "found", note };
    },
  });
}

export function createKnowledgeCreateNoteTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeCreateNote",
    description: "Create a persisted personal Markdown note in an existing Space. This creates knowledge content, not an external filesystem file.",
    metadata: writeMetadata,
    inputSchema: schema({
      spaceId: { type: "string" },
      title: { type: "string" },
      bodyMarkdown: { type: "string" },
      materialRefs: { type: "array", items: { type: "string" } },
    }, ["spaceId"]),
    execute: async (input, context) => {
      const record = asRecord(input);
      const spaceId = stringOrUndefined(record.spaceId);
      const title = optionalString(record.title);
      const bodyMarkdown = optionalString(record.bodyMarkdown);
      const materialRefs = optionalStringArray(record.materialRefs);
      if (spaceId === undefined || title === null || bodyMarkdown === null || materialRefs === null) {
        return invalid("spaceId is required; title, bodyMarkdown and materialRefs must be omitted or valid values.");
      }
      return resultFor(
        () => options.knowledge.commands.createNote({ spaceId, title, bodyMarkdown, materialRefs, actor: agentActor(context) }),
        (note) => ({ status: "created", note }),
      );
    },
  });
}

export function createKnowledgeUpdateNoteTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeUpdateNote",
    description: "Update the title or Markdown body of a personal note using the revision returned by KnowledgeRead or KnowledgeSearch. A stale revision is rejected and never overwrites newer content.",
    metadata: writeMetadata,
    inputSchema: schema({
      noteId: { type: "string" },
      expectedRevision: { type: "number" },
      title: { type: "string" },
      bodyMarkdown: { type: "string" },
    }, ["noteId", "expectedRevision"]),
    execute: async (input, context) => {
      const record = asRecord(input);
      const noteId = stringOrUndefined(record.noteId);
      const expectedRevision = integer(record.expectedRevision);
      const title = optionalString(record.title);
      const bodyMarkdown = optionalString(record.bodyMarkdown);
      if (noteId === undefined || expectedRevision === undefined || title === null || bodyMarkdown === null) {
        return invalid("noteId and expectedRevision are required; title and bodyMarkdown must be omitted or strings.");
      }
      if (title === undefined && bodyMarkdown === undefined) return invalid("title or bodyMarkdown is required.");
      return resultFor(
        () => options.knowledge.commands.updateNote({ id: noteId, expectedRevision, title, bodyMarkdown, actor: agentActor(context) }),
        () => ({ status: "updated", noteId, revision: expectedRevision + 1 }),
      );
    },
  });
}

export function createKnowledgeDeleteNoteTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeDeleteNote",
    description: "Delete a persisted personal Markdown note using the revision returned by KnowledgeRead or KnowledgeSearch. A stale revision is rejected and never deletes newer content.",
    metadata: destructiveMetadata,
    inputSchema: schema({
      noteId: { type: "string" },
      expectedRevision: { type: "number" },
    }, ["noteId", "expectedRevision"]),
    execute: async (input, context) => {
      const record = asRecord(input);
      const noteId = stringOrUndefined(record.noteId);
      const expectedRevision = integer(record.expectedRevision);
      if (noteId === undefined || expectedRevision === undefined) {
        return invalid("noteId and expectedRevision are required.");
      }
      return resultFor(
        () => options.knowledge.commands.deleteNote({ id: noteId, expectedRevision, actor: agentActor(context) }),
        () => ({ status: "deleted", noteId }),
      );
    },
  });
}

export function createKnowledgeCollectTool(options: PersonalKnowledgeToolOptions): ToolExecutor {
  return tool({
    name: "KnowledgeCollect",
    description: "Collect an existing personal note or Space reference into Brain. Space references are copied into AgentArbor-managed knowledge storage so the collected content remains readable independently of the source.",
    metadata: writeMetadata,
    inputSchema: schema({
      refId: { type: "string" },
      kind: { type: "string", enum: ["note", "space_reference"] },
      relativePath: { type: "string", description: "Optional child file or folder path inside a Space folder reference." },
    }, ["refId", "kind"]),
    execute: async (input) => {
      const record = asRecord(input);
      const refId = stringOrUndefined(record.refId);
      const kind = knowledgePageKind(record.kind);
      const relativePath = record.relativePath === undefined ? undefined : stringOrUndefined(record.relativePath);
      if (refId === undefined || kind === undefined || (record.relativePath !== undefined && relativePath === undefined)) {
        return invalid("refId and a supported kind are required; relativePath must be a non-empty string when provided.");
      }
      const page: KnowledgePage = { refId, kind, collectedAt: Date.now() };
      return resultFor(
        () => kind === "space_reference"
          ? options.knowledge.commands.collectSpaceReference({ referenceId: refId, ...(relativePath === undefined ? {} : { relativePath }) })
          : options.knowledge.commands.execute({ type: "knowledge.collect", page }).then(() => page),
        (collected) => ({ status: "collected", page: collected }),
      );
    },
  });
}

type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly metadata: NonNullable<ToolDefinition["metadata"]>;
  readonly inputSchema: ToolDefinition["inputSchema"];
  readonly execute: (input: unknown, context: ToolExecutionContext) => Promise<unknown>;
};

function tool(spec: ToolSpec): ToolExecutor {
  return {
    definition: {
      name: spec.name,
      description: spec.description,
      metadata: spec.metadata,
      inputSchema: spec.inputSchema,
    },
    execute: (input: unknown, context: ToolExecutionContext) => spec.execute(input, context),
  };
}

const readMetadata = { category: "workspace", riskLevel: "low", operationType: "read-only", requiresConfirmation: false } as const;
const writeMetadata = { category: "workspace", riskLevel: "low", operationType: "read-write", requiresConfirmation: false } as const;
const destructiveMetadata = { category: "workspace", riskLevel: "high", operationType: "read-write", requiresConfirmation: true, fileOperation: "delete" } as const;

function agentActor(context: ToolExecutionContext) {
  return {
    kind: "agent" as const,
    actorId: context.callerAgentId,
    traceId: context.traceId,
    goalId: context.goalId,
    ...(context.toolCallId === undefined ? {} : { toolCallId: context.toolCallId }),
  };
}

function schema(
  properties: ToolDefinition["inputSchema"]["properties"],
  required: readonly string[],
): ToolDefinition["inputSchema"] {
  return { type: "object", properties, required, additionalProperties: false };
}

function invalid(message: string) { return { status: "invalid_input", message }; }
function optionalString(value: unknown): string | undefined | null { return value === undefined ? undefined : stringOrUndefined(value) ?? null; }
function integer(value: unknown): number | undefined {
  const parsed = numberOrUndefined(value);
  return parsed !== undefined && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
function optionalInteger(value: unknown): number | undefined | null {
  return value === undefined ? undefined : integer(value) ?? null;
}
function optionalStringArray(value: unknown): readonly string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) return null;
  return value;
}
function knowledgePageKind(value: unknown): "note" | "space_reference" | undefined {
  return value === "note" || value === "space_reference" ? value : undefined;
}

async function resultFor<T>(operation: () => Promise<T>, project: (value: T) => unknown): Promise<unknown> {
  try {
    return project(await operation());
  } catch (error) {
    if (error instanceof PersonalKnowledgeError && isExpectedKnowledgeOperationError(error.code)) {
      return { status: error.code, message: error.message };
    }
    throw error;
  }
}

function isExpectedKnowledgeOperationError(code: PersonalKnowledgeError["code"]): boolean {
  return code === "personal_knowledge_invalid_input"
    || code === "personal_note_not_found"
    || code === "personal_note_revision_conflict"
    || code === "knowledge_theme_not_found";
}
