import type { ToolConfirmationPolicy } from "../contracts/config";
import type { ToolCatalogItem } from "../contracts/tools";

export function confirmationRuleLabel(tool: ToolCatalogItem, policy: ToolConfirmationPolicy = "prompt"): string {
  if (tool.available === false) {
    return tool.unavailableReason ?? "当前不可用";
  }
  if (tool.requiresConfirmation === true && policy === "full_access") {
    return "完全访问：跳过逐条确认";
  }
  return tool.confirmationLabel ??
    ([tool.riskLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") ||
    "需确认");
}

export function providerName(value: string): string {
  if (value === "tavily") return "Tavily";
  if (value === "exa") return "Exa";
  if (value === "zai") return "Z.AI";
  if (value === "metaso") return "秘塔搜索";
  if (value === "google") return "Google";
  if (value === "bing") return "Bing Legacy";
  if (value === "model_builtin") return "模型内置";
  if (value === "none") return "未启用";
  return value;
}
