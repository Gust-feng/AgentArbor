import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import type {
  ExperienceCandidateContentInput,
  ExperienceCandidateFeatureError,
  ExperienceCandidateListFilter,
} from "../experience-candidate/contracts.js";
import { PanelHttpError, readJsonBody, writeJson } from "./http-utils.js";
import type { PanelRuntime } from "./runtime.js";

const contentRequestSchema = z.object({
  sourcePathMemoryIds: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  statement: z.string().min(1),
  appliesWhen: z.array(z.string().min(1)).min(1),
  notApplicableWhen: z.array(z.string().min(1)).optional(),
  confidence: z.enum(["low", "medium", "high"]),
}).strict();

const decisionRequestSchema = z.object({
  decision: z.enum(["accept", "reject", "retire"]),
  reason: z.string().optional(),
}).strict();

function parseCandidateContentInput(raw: unknown): ExperienceCandidateContentInput {
  const result = contentRequestSchema.safeParse(raw);
  if (!result.success) {
    throw new PanelHttpError(400, "invalid_experience_candidate_input", "经验候选内容无效。");
  }
  return {
    sourcePathMemoryIds: result.data.sourcePathMemoryIds,
    title: result.data.title,
    statement: result.data.statement,
    appliesWhen: result.data.appliesWhen,
    notApplicableWhen: result.data.notApplicableWhen ?? [],
    confidence: result.data.confidence,
  };
}

function parseCandidateListQuery(url: URL): ExperienceCandidateListFilter {
  const filter: {
    status?: ExperienceCandidateListFilter["status"];
    sourcePathMemoryId?: string;
    limit?: number;
  } = {};
  const status = url.searchParams.get("status");
  if (status !== null && status !== "") {
    const parsed = z.enum(["proposed", "accepted", "rejected", "retired"]).safeParse(status);
    if (!parsed.success) {
      throw new PanelHttpError(400, "invalid_experience_candidate_status", "经验候选状态过滤条件无效。");
    }
    filter.status = parsed.data;
  }
  const sourcePathMemoryId = url.searchParams.get("sourcePathMemoryId");
  if (sourcePathMemoryId !== null && sourcePathMemoryId !== "") {
    filter.sourcePathMemoryId = sourcePathMemoryId;
  }
  const limit = url.searchParams.get("limit");
  if (limit !== null && limit !== "") {
    const parsed = Number(limit);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new PanelHttpError(400, "invalid_experience_candidate_limit", "经验候选数量限制无效。");
    }
    filter.limit = parsed;
  }
  return filter;
}

/** ExperienceCandidate governance API (ADR-0032 phase 2): propose, revise, decide, inspect. */
export async function handlePanelExperienceCandidateRoute(
  runtime: PanelRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const feature = runtime.experienceCandidateFeature;

  if (url.pathname === "/api/experience-candidates") {
    if (request.method === "POST") {
      const input = parseCandidateContentInput(await readJsonBody(request));
      const candidate = await feature.commands.propose(input);
      writeJson(response, 201, { ok: true, candidate });
      return true;
    }
    if (request.method === "GET") {
      const candidates = await feature.queries.listHeads(parseCandidateListQuery(url));
      writeJson(response, 200, { ok: true, candidates });
      return true;
    }
    return false;
  }

  const match = /^\/api\/experience-candidates\/([^/]+)(\/revisions|\/decision)?$/u.exec(url.pathname);
  if (match === null) return false;
  const candidateId = decodeURIComponent(match[1] ?? "");
  const section = match[2];

  if (section === undefined && request.method === "GET") {
    const candidate = await feature.queries.getHead(candidateId);
    if (candidate === undefined) {
      throw new PanelHttpError(404, "experience_candidate_not_found", "未找到经验候选。");
    }
    writeJson(response, 200, { ok: true, candidate, revisions: candidate.revision });
    return true;
  }

  if (section === "/revisions" && request.method === "GET") {
    const revisions = await feature.queries.listRevisions(candidateId);
    if (revisions.length === 0) {
      throw new PanelHttpError(404, "experience_candidate_not_found", "未找到经验候选。");
    }
    writeJson(response, 200, { ok: true, revisions });
    return true;
  }

  if (section === "/revisions" && request.method === "POST") {
    const input = parseCandidateContentInput(await readJsonBody(request));
    const candidate = await feature.commands.revise(candidateId, input);
    writeJson(response, 200, { ok: true, candidate });
    return true;
  }

  if (section === "/decision" && request.method === "POST") {
    const result = decisionRequestSchema.safeParse(await readJsonBody(request));
    if (!result.success) {
      throw new PanelHttpError(400, "invalid_experience_candidate_decision", "经验候选治理决策无效。");
    }
    const decisionInput = result.data.reason === undefined ? undefined : { reason: result.data.reason };
    const candidate = result.data.decision === "accept"
      ? await feature.commands.accept(candidateId, decisionInput)
      : result.data.decision === "reject"
        ? await feature.commands.reject(candidateId, decisionInput)
        : await feature.commands.retire(candidateId, decisionInput);
    writeJson(response, 200, { ok: true, candidate });
    return true;
  }

  return false;
}

export function experienceCandidateFeatureHttpError(error: ExperienceCandidateFeatureError): PanelHttpError {
  switch (error.code) {
    case "experience_candidate_feature_released":
      return new PanelHttpError(503, "panel_runtime_quiescing", "面板正在关闭，不能接受新的请求。");
    case "experience_candidate_not_found":
      return new PanelHttpError(404, error.code, error.message);
    case "experience_candidate_invalid_transition":
    case "experience_candidate_revision_conflict":
      return new PanelHttpError(409, error.code, error.message);
    case "experience_candidate_source_not_found":
      return new PanelHttpError(422, error.code, error.message);
    case "experience_candidate_snapshot_incompatible":
    case "experience_candidate_repository_failure":
      return new PanelHttpError(500, error.code, error.message);
  }
}
