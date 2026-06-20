import {
  modelCatalogDisplayNameFromId,
  type ModelProviderModelCatalog,
  type ModelProviderModelCatalogItem,
  type SanitizedModelProviderConfig,
} from "../../domain/config/index.js";
import { nowIso } from "../../kernel/id.js";
import { normalizeOpenAICompatibleSdkBaseUrl } from "./openai-compatible-base-url.js";
import { asRecord, numberOrUndefined, stringOrUndefined } from "./provider-value-utils.js";
import { joinUrlPath, resolveGlobalModelCatalogFetch } from "./model-catalog-shared.js";
import type { ModelCatalogFetchLike } from "./model-catalog-shared.js";

// 保留历史导出面：catalog fetch 类型仍从本模块对外暴露（经 index.js 被 intelligence-channel-factory 使用）。
export type { ModelCatalogFetchLike, ModelCatalogFetchLikeResponse } from "./model-catalog-shared.js";

export type OpenAICompatibleModelCatalogOptions = {
  readonly profile: Pick<SanitizedModelProviderConfig, "profileId" | "label" | "baseUrl">;
  readonly apiKey: string;
  readonly fetch?: ModelCatalogFetchLike;
  readonly abortSignal?: AbortSignal;
};

export async function fetchOpenAICompatibleModelCatalog(
  options: OpenAICompatibleModelCatalogOptions
): Promise<ModelProviderModelCatalog> {
  const fetchImpl = options.fetch ?? resolveGlobalModelCatalogFetch();
  if (fetchImpl === undefined) {
    throw new Error("当前运行环境没有可用的 fetch，无法获取模型列表。");
  }

  const baseUrl = normalizeOpenAICompatibleSdkBaseUrl(options.profile.baseUrl);
  const modelsPath = "/models";
  const response = await fetchImpl(joinUrlPath(baseUrl, modelsPath), {
    method: "GET",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
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
      if (id === undefined) {
        return undefined;
      }
      const created = numberOrUndefined(model.created);
      return {
        id,
        displayName: modelCatalogDisplayNameFromId(id),
        owner: stringOrUndefined(model.owned_by),
        createdAt: created === undefined ? undefined : new Date(created * 1000).toISOString(),
      };
    })
    .filter((item): item is ModelProviderModelCatalogItem => item !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}
