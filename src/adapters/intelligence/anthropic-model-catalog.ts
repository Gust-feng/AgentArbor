import type {
  ModelProviderModelCatalog,
  ModelProviderModelCatalogItem,
  SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { nowIso } from "../../kernel/id.js";
import { asRecord, stringOrUndefined } from "./provider-value-utils.js";
import {
  type ModelCatalogFetchLike,
  joinUrlPath,
  resolveGlobalModelCatalogFetch,
} from "./model-catalog-shared.js";

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

function normalizeAnthropicBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}
