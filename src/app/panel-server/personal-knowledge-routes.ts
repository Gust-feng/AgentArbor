import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { PersonalKnowledgeError, type PersonalKnowledgeCommand } from "../personal-knowledge/index.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";

const id = z.string().trim().min(1).max(512);
const timestamp = z.number().int().nonnegative();
const pageKind = z.enum(["note", "material", "space_reference"]);
const origin = z.enum(["agent", "user"]);
const actor = z.enum(["agent", "user"]);

const createNoteSchema = z.object({
  id: id.optional(),
  spaceId: id,
  title: z.string().max(1_000).optional(),
  bodyMarkdown: z.string().max(10_000_000).optional(),
  materialRefs: z.array(id).max(10_000).optional(),
}).strict();

const updateNoteSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().max(1_000).optional(),
  bodyMarkdown: z.string().max(10_000_000).optional(),
}).strict().refine((value) => value.title !== undefined || value.bodyMarkdown !== undefined, "No note fields were provided.");

const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("knowledge.collect"), page: z.object({ refId: id, kind: pageKind, collectedAt: timestamp }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.uncollect"), refId: id }).strict(),
  z.object({ type: z.literal("knowledge.link_add"), link: z.object({ from: id, to: id }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.link_remove"), link: z.object({ from: id, to: id }).strict() }).strict(),
  z.object({ type: z.literal("knowledge.opened"), refId: id, openedAt: timestamp }).strict(),
  z.object({ type: z.literal("theme.create"), theme: z.object({ id, name: z.string().trim().min(1).max(200), color: z.string().min(1).max(100), origin }).strict() }).strict(),
  z.object({ type: z.literal("theme.rename"), themeId: id, name: z.string().trim().min(1).max(200) }).strict(),
  z.object({ type: z.literal("theme.delete"), themeId: id }).strict(),
  z.object({ type: z.literal("theme.merge"), fromId: id, toId: id }).strict(),
  z.object({ type: z.literal("theme.assign"), assignment: z.object({ refId: id, themeId: id, by: actor, locked: z.boolean() }).strict() }).strict(),
  z.object({ type: z.literal("theme.unassign"), refId: id, themeId: id }).strict(),
  z.object({ type: z.literal("theme.toggle_lock"), refId: id, themeId: id }).strict(),
]);

const legacyImportSchema = z.object({
  importKey: z.literal("redesign-local-storage-v1"),
  fallbackSpaceId: id,
  notes: z.array(z.object({
    id,
    title: z.string().max(1_000),
    body: z.string().max(10_000_000),
    createdAt: timestamp,
    updatedAt: timestamp,
    materialRefs: z.array(id).max(10_000).optional(),
  }).strict()).max(100_000),
  pages: z.array(z.object({ refId: id, kind: pageKind, collectedAt: timestamp }).strict()).max(100_000),
  links: z.array(z.object({ from: id, to: id }).strict()).max(500_000),
  themes: z.array(z.object({ id, name: z.string().max(200), color: z.string().max(100), origin }).strict()).max(10_000),
  assignments: z.array(z.object({ refId: id, themeId: id, by: actor, locked: z.boolean() }).strict()).max(500_000),
  recentlyOpened: z.record(id, timestamp),
}).strict();

export async function handlePanelPersonalKnowledgeRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const feature = runtime.personalKnowledgeFeature;
  if (url.pathname === "/api/personal-knowledge/search" && request.method === "GET") {
    const query = url.searchParams.get("q")?.trim();
    const spaceId = url.searchParams.get("spaceId")?.trim() || undefined;
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (query === undefined || query.length === 0 || query.length > 1_000
      || (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100))) {
      throw invalidInput();
    }
    writeJson(response, 200, {
      ok: true,
      results: await feature.queries.search({ query, spaceId, limit }),
    });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge" && request.method === "GET") {
    writeJson(response, 200, { ok: true, snapshot: await feature.queries.snapshot() });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/notes" && request.method === "POST") {
    const input = parse(createNoteSchema, await readJsonBody(request));
    writeJson(response, 201, { ok: true, note: await feature.commands.createNote(input) });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/notes/reorder" && request.method === "POST") {
    const input = parse(z.object({ orderedIds: z.array(id).max(100_000) }).strict(), await readJsonBody(request));
    await feature.commands.reorderNotes(input.orderedIds);
    writeJson(response, 200, { ok: true });
    return true;
  }
  const noteMatch = /^\/api\/personal-knowledge\/notes\/([^/]+)$/u.exec(url.pathname);
  if (noteMatch !== null && request.method === "PATCH") {
    const input = parse(updateNoteSchema, await readJsonBody(request));
    await feature.commands.updateNote({ id: decode(noteMatch[1]), ...input });
    writeJson(response, 200, { ok: true });
    return true;
  }
  if (noteMatch !== null && request.method === "DELETE") {
    const expectedRevision = Number(url.searchParams.get("expectedRevision"));
    if (!Number.isInteger(expectedRevision) || expectedRevision <= 0) throw invalidInput();
    await feature.commands.deleteNote({ id: decode(noteMatch[1]), expectedRevision });
    writeJson(response, 200, { ok: true });
    return true;
  }
  if (url.pathname === "/api/personal-knowledge/commands" && request.method === "POST") {
    const command = parse(commandSchema, await readJsonBody(request)) as PersonalKnowledgeCommand;
    await feature.commands.execute(command as Exclude<PersonalKnowledgeCommand, { readonly type: "note.create" | "note.update" | "note.delete" | "note.reorder" }>);
    writeJson(response, 200, { ok: true });
    return true;
  }
  // One-release compatibility route. Delete with v0.5 after v0.4 has shipped.
  if (url.pathname === "/api/personal-knowledge/compat/import" && request.method === "POST") {
    const imported = await feature.commands.importLegacy(parse(legacyImportSchema, await readJsonBody(request)));
    writeJson(response, 200, { ok: true, imported });
    return true;
  }
  return false;
}

export function personalKnowledgeHttpError(error: PersonalKnowledgeError): PanelHttpError {
  switch (error.code) {
    case "personal_knowledge_released":
      return new PanelHttpError(503, "panel_runtime_quiescing", error.message);
    case "personal_knowledge_invalid_input":
      return new PanelHttpError(400, error.code, error.message);
    case "personal_note_not_found":
    case "knowledge_theme_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "personal_note_revision_conflict":
      return new PanelHttpError(409, error.code, error.message);
    case "personal_knowledge_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidInput();
  return result.data;
}

function invalidInput(): PanelHttpError {
  return new PanelHttpError(400, "invalid_personal_knowledge_input", "个人知识数据无效。");
}

function decode(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}
