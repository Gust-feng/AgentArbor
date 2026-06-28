import type { ModelFailureKind } from "../../domain/intelligence/index.js";
import { asRecord } from "./provider-value-utils.js";

export type ProviderContextWindowExceededHandler = (input: {
  readonly message: string;
  readonly status?: number;
}) => void | Promise<void>;

/**
 * 适配器层共享的失败分类逻辑。
 *
 * 同一种失败（例如超时）在不同 provider 协议下必须归一化为相同的失败语义，
 * 不能因为协议不同而让上层 Agent 看到不同的 `ModelFailureKind`。
 * 这里集中提供 HTTP 状态码 → 失败分类的映射，以及“超时样”错误的启发式判断，
 * 供 OpenAI Chat Completions 与 OpenAI Responses 两个 provider 共用，
 * 确保两者对失败的理解完全一致。
 */

/**
 * 把 HTTP 状态码映射为标准 `ModelFailureKind`。
 *
 * - 401 / 403 → `provider_auth`
 * - 429       → `provider_rate_limit`
 * - 408 / 504 → `provider_timeout`（请求超时 / 网关超时）
 * - 其余      → `provider_response`
 */
export function classifyProviderFailureKind(status: number): ModelFailureKind {
  if (status === 401 || status === 403) {
    return "provider_auth";
  }
  if (status === 429) {
    return "provider_rate_limit";
  }
  if (status === 408 || status === 504) {
    return "provider_timeout";
  }
  return "provider_response";
}

/**
 * 判断 HTTP 状态码对应的 provider 失败是否适合由上层重试。
 *
 * 408 / 504 表示本轮请求或网关超时，429 表示限流，其他 5xx 表示 provider
 * 或中间网关临时失败；这些场景都属于可重试失败。认证失败和普通 4xx 不可重试。
 */
export function isRetryableProviderFailureStatus(status: number): boolean {
  const failureKind = classifyProviderFailureKind(status);
  return failureKind === "provider_timeout" || failureKind === "provider_rate_limit" || status >= 500;
}

/**
 * 启发式判断一个错误是否“看起来像超时”。
 *
 * 当请求没有拿到 HTTP 状态码（例如传输层被中断、SDK 抛出连接错误）时，
 * 通过错误名 / 错误信息中是否包含 timeout / timed out 来识别超时，
 * 以便归一化为 `provider_timeout` 而非笼统的 `provider_network`。
 */
export function isTimeoutLikeError(error: unknown): boolean {
  const record = asRecord(error);
  const name = typeof record.name === "string" ? record.name.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
  return name.includes("timeout") || message.includes("timeout") || message.includes("timed out");
}

export function isContextWindowExceededMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("context_length_exceeded") ||
    normalized.includes("maximum context length") ||
    normalized.includes("context window") ||
    normalized.includes("context length") ||
    normalized.includes("prompt is too long") ||
    normalized.includes("input is too long") ||
    normalized.includes("too many tokens") ||
    /tokens?\s+(?:exceed|exceeded|exceeds)\b/.test(normalized) ||
    /(?:exceed|exceeded|exceeds)\s+[^.]{0,80}\btokens?\b/.test(normalized)
  );
}
