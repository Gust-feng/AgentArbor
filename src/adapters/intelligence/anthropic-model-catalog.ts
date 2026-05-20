import type {
  ModelProviderModelCatalog,
  ModelProviderModelCatalogItem,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { nowIso } from "../../kernel/id.js";
import type {
  ModelCatalogFetchLike,
  ModelCatalogFetchLikeResponse,
} from "./openai-compatible-model-catalog.js";

export type AnthropicModelCatalogOptions = {
  readonly profile: Pick<SanitizedModelProviderConfig, "profileId" | "label" | "baseUrl">;
  readonly apiKey: string;
  readonly fetch?: ModelCatalogFetchLike;
  readonly abortSignal?: AbortSignal;
};

export async function fetchAnthropicModelCatalog(
  options: AnthropicModelCatalogOptions
): Promise<ModelProviderModelCatalog> {
  const fetchImpl = options.fetch ?? resolveGlobalModelCatalogFetch();
  if (fetchImpl === undefined) {
    throw new Error("当前运行环境没有可用的 fetch，无法获取模型列表。");
  }

  const baseUrl = normalizeAnthropicBaseUrl(options.profile.baseUrl);
  const modelsPath = baseUrl.endsWith("/v1") ? "/models" : "/v1/models";
  const response = await fetchImpl(joinUrlPath(baseUrl, modelsPath), {
    method: "GET",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
      accept: "application/json",
    },
    signal: options.abortSignal,
  });
  if (!response.ok) {
    throw new Error(`模型列表接口返回 HTTP ${response.status}。`);
  }

  const raw = await response.json();
  return {
    profileId: options.profile.profileId,
    label: options.profile.label,
    baseUrl,
    modelsPath,
    fetchedAt: nowIso(),
    models: parseModels(raw),
  };
}

function parseModels(raw: unknown): readonly ModelProviderModelCatalogItem[] {
  const record = asRecord(raw);
  const data = Array.isArray(record.data) ? record.data : [];
  return data
    .map((item): ModelProviderModelCatalogItem | undefined => {
      const model = asRecord(item);
      const id = stringOrUndefined(model.id);
      if (id === undefined) return undefined;
      return {
        id,
        displayName: stringOrUndefined(model.display_name) ?? id,
        owner: "Anthropic",
        createdAt: stringOrUndefined(model.created_at),
      };
    })
    .filter((item): item is ModelProviderModelCatalogItem => item !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveGlobalModelCatalogFetch(): ModelCatalogFetchLike | undefined {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return undefined;
  }
  return async (url, init): Promise<ModelCatalogFetchLikeResponse> => {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  };
}

function normalizeAnthropicBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
