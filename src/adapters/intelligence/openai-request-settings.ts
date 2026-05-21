import type { OpenAIModelRequestSettings } from "../../domain/config/index.js";

export function configuredOpenAIStream(
  requestedStream: boolean,
  settings: OpenAIModelRequestSettings | undefined
): boolean {
  return requestedStream && settings?.stream !== false;
}

export function configuredOpenAIOutputTokenLimit(
  requestBudgetMaxOutputTokens: number | undefined,
  settings: OpenAIModelRequestSettings | undefined
): number | undefined {
  const configured = settings?.maxOutputTokens;
  if (configured === undefined) {
    return requestBudgetMaxOutputTokens;
  }
  if (requestBudgetMaxOutputTokens === undefined) {
    return configured;
  }
  return Math.min(requestBudgetMaxOutputTokens, configured);
}

export function buildOpenAIResponsesControlFields(input: {
  readonly requestBudgetMaxOutputTokens?: number;
  readonly settings?: OpenAIModelRequestSettings;
}): Record<string, unknown> | undefined {
  const settings = input.settings;
  return cleanRecord({
    temperature: settings?.temperature,
    top_p: settings?.topP,
    max_output_tokens: configuredOpenAIOutputTokenLimit(input.requestBudgetMaxOutputTokens, settings),
    reasoning: cleanRecord({
      effort: settings?.reasoningEffort,
      summary: configuredOpenAIReasoningSummary(settings),
    }),
    text: cleanRecord({
      verbosity: settings?.textVerbosity,
    }),
    service_tier: settings?.serviceTier,
    truncation: settings?.truncation,
    parallel_tool_calls: settings?.parallelToolCalls,
    store: settings?.store,
  });
}

function configuredOpenAIReasoningSummary(
  settings: OpenAIModelRequestSettings | undefined
): OpenAIModelRequestSettings["reasoningSummary"] | undefined {
  if (settings?.reasoningSummary !== undefined) {
    return settings.reasoningSummary;
  }
  return settings?.reasoningEffort === undefined || settings.reasoningEffort === "none"
    ? undefined
    : "auto";
}

export function buildOpenAIChatCompletionsControlFields(input: {
  readonly requestBudgetMaxOutputTokens?: number;
  readonly settings?: OpenAIModelRequestSettings;
}): Record<string, unknown> | undefined {
  const settings = input.settings;
  return cleanRecord({
    temperature: settings?.temperature,
    top_p: settings?.topP,
    max_completion_tokens: configuredOpenAIOutputTokenLimit(input.requestBudgetMaxOutputTokens, settings),
    reasoning_effort: settings?.reasoningEffort,
  });
}

export function cleanRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  const compacted = entries.filter(([, value]) => !isEmptyPlainRecord(value));
  return compacted.length === 0 ? undefined : Object.fromEntries(compacted);
}

function isEmptyPlainRecord(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0;
}
