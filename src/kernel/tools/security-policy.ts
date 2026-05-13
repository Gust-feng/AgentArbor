import type { ConfirmationRequest } from "../../domain/basic-agent/index.js";
import type {
  ToolCallRequest,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolSecurityDecision,
  ToolSecurityEvaluationContext,
} from "../../domain/tools/index.js";
import { nowIso } from "../id.js";
import { redactOrdinaryToolText } from "./tool-result-envelope.js";

export function evaluateToolCallSecurity(input: {
  readonly request: ToolCallRequest;
  readonly definition: ToolDefinition;
  readonly metadata: ToolDefinitionMetadata;
  readonly context: ToolSecurityEvaluationContext;
}): ToolSecurityDecision {
  const confirmationId = confirmationIdForToolCall(input.request.callId);
  if (input.context.approvedConfirmationIds?.includes(confirmationId) === true) {
    return { decision: "allow", reason: "Matching confirmation id was approved for this tool call." };
  }

  const urlDecision = evaluateUrlSecurity(input.request);
  if (urlDecision !== undefined) {
    return urlDecision;
  }

  if (input.metadata.requiresConfirmation || requiresPlatformConfirmation(input.metadata, input.context.platform)) {
    return approvalDecision({
      request: input.request,
      definition: input.definition,
      metadata: input.metadata,
      reason: `${input.definition.name} requires user confirmation for ${input.metadata.operationType}.`,
    });
  }

  return { decision: "allow", reason: "Tool call is allowed by metadata and platform policy." };
}

export function confirmationRequestFromSecurityDecision(input: {
  readonly request: ToolCallRequest;
  readonly decision: Extract<ToolSecurityDecision, { readonly decision: "approval_required" }>;
}): ConfirmationRequest {
  return {
    confirmationId: confirmationIdForToolCall(input.request.callId),
    runId: input.request.callId,
    title: input.decision.title,
    actionSummary: input.decision.actionSummary,
    affectedResources: input.decision.affectedResources,
    riskLevel: input.decision.riskLevel,
    resumeAvailability: "live",
    requestedAt: nowIso(),
    sourceRefs: input.decision.sourceRefs,
  };
}

export function confirmationIdForToolCall(callId: string): string {
  return `confirmation-${callId}`;
}

function requiresPlatformConfirmation(metadata: ToolDefinitionMetadata, platform: NodeJS.Platform): boolean {
  return platform === "win32" && metadata.operationType !== "read-only";
}

function approvalDecision(input: {
  readonly request: ToolCallRequest;
  readonly definition: ToolDefinition;
  readonly metadata: ToolDefinitionMetadata;
  readonly reason: string;
}): Extract<ToolSecurityDecision, { readonly decision: "approval_required" }> {
  return {
    decision: "approval_required",
    reason: input.reason,
    title: "需要确认",
    actionSummary: redactOrdinaryToolText(
      `工具 ${input.definition.name} 请求执行 ${input.metadata.operationType} 操作。${input.definition.description}`,
      500
    ),
    affectedResources: affectedResourcesFromInput(input.request.input),
    riskLevel: input.metadata.riskLevel,
    sourceRefs: [`tool:${input.request.callId}`],
  };
}

function evaluateUrlSecurity(request: ToolCallRequest): ToolSecurityDecision | undefined {
  const url = urlFromInput(request.input);
  if (url === undefined) {
    return undefined;
  }
  const parsed = parseUrl(url);
  if (parsed === undefined || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    return {
      decision: "blocked",
      code: "url_protocol_blocked",
      reason: "Only HTTP and HTTPS URLs are allowed.",
      affectedResources: [redactOrdinaryToolText(url, 220)],
      sourceRefs: [`tool:${request.callId}`],
    };
  }
  if (hasSensitiveQuery(parsed)) {
    return {
      decision: "blocked",
      code: "url_secret_query_blocked",
      reason: "URL contains secret-like query parameters.",
      affectedResources: [redactOrdinaryToolText(parsed.origin + parsed.pathname, 220)],
      sourceRefs: [`tool:${request.callId}`],
    };
  }
  if (isInternalHost(parsed.hostname)) {
    return {
      decision: "approval_required",
      reason: "Fetching local or private-network URLs requires user confirmation.",
      title: "需要确认内部网络访问",
      actionSummary: `工具请求读取内部或本机地址：${redactOrdinaryToolText(parsed.origin, 220)}。`,
      affectedResources: [redactOrdinaryToolText(parsed.origin, 220)],
      riskLevel: "medium",
      sourceRefs: [`tool:${request.callId}`],
    };
  }
  return undefined;
}

function urlFromInput(input: unknown): string | undefined {
  const record = asRecord(input);
  return stringOrUndefined(record.url);
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function hasSensitiveQuery(url: URL): boolean {
  const sensitiveKeys = ["token", "access_token", "api_key", "apikey", "key", "secret", "authorization", "auth"];
  for (const key of url.searchParams.keys()) {
    const normalized = key.toLowerCase();
    if (sensitiveKeys.some((candidate) => normalized.includes(candidate))) {
      return true;
    }
  }
  return false;
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }
  return host === "169.254.169.254" || host.startsWith("169.254.");
}

function affectedResourcesFromInput(input: unknown): readonly string[] {
  const record = asRecord(input);
  const values = [
    stringOrUndefined(record.path),
    stringOrUndefined(record.command),
    stringOrUndefined(record.url),
    stringOrUndefined(record.ref),
  ];
  return values.filter((value): value is string => value !== undefined).map((value) => redactOrdinaryToolText(value, 240)).slice(0, 8);
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
