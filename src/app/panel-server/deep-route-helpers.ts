import { PanelHttpError } from "./http-utils.js";

export function parseDeepRunListLimit(url: URL): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim().length === 0) {
    return 50;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new PanelHttpError(400, "invalid_deep_run_limit", "多 Agent 运行列表 limit 必须为正整数。");
  }
  return Math.min(value, 200);
}
