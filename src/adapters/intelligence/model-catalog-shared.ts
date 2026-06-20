/**
 * 模型 catalog 适配器的共享逻辑。
 *
 * OpenAI 兼容 catalog 与 Anthropic catalog 都需要：从全局 fetch 构造 catalog 专用 fetch、
 * 拼接 base URL 与路径、以及统一的 catalog fetch 响应类型。原先两份 catalog 各自重复定义，
 * 这里收敛为单一来源。catalog 各自的 `parseModels` 因字段不同仍保留在各自文件中。
 */

export type ModelCatalogFetchLike = (
  url: string,
  init: {
    readonly method: "GET";
    readonly headers: Record<string, string>;
    readonly signal?: AbortSignal;
  }
) => Promise<ModelCatalogFetchLikeResponse>;

export type ModelCatalogFetchLikeResponse = {
  readonly ok: boolean;
  readonly status: number;
  readonly json: () => Promise<unknown>;
  readonly text?: () => Promise<string>;
};

/**
 * 用当前运行环境的全局 fetch 构造一个 catalog 专用 fetch；若环境无 fetch 则返回 undefined。
 */
export function resolveGlobalModelCatalogFetch(): ModelCatalogFetchLike | undefined {
  const fetchImpl = globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    return undefined;
  }
  return async (url, init) => {
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

/**
 * 把 base URL 与路径拼接为完整 URL，容忍两端的多余斜杠。
 */
export function joinUrlPath(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
