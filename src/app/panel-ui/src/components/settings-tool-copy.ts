import type { ToolCatalogItem } from "../contracts/tools";

export function toolTitle(tool: ToolCatalogItem): string {
  return tool.displayName ?? fallbackToolName(tool.name);
}

export function toolDescription(tool: ToolCatalogItem): string {
  return tool.displayDescription ?? tool.description ?? "运行时工具";
}

export function toolMeta(tool: ToolCatalogItem): string {
  if (tool.requiresConfirmation === true || tool.riskLevel === "high") return tool.confirmationLabel ?? "高影响";
  return [tool.categoryLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") || "可用";
}

export function confirmationRuleLabel(tool: ToolCatalogItem): string {
  if (tool.available === false) {
    return tool.unavailableReason ?? "当前不可用";
  }
  return tool.confirmationLabel ??
    ([tool.riskLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") ||
    "高影响动作");
}

export function providerName(value: string): string {
  if (value === "tavily") return "Tavily";
  if (value === "none") return "未启用";
  return value;
}

function fallbackToolName(name: string): string {
  if (name.includes("read_file")) return "读取文件";
  if (name.includes("create_file")) return "创建文件";
  if (name.includes("edit_file")) return "编辑文件";
  if (name.includes("delete_file")) return "删除文件";
  if (name.includes("shell") || name.includes("command")) return "命令执行";
  if (name.includes("search")) return "网页搜索";
  if (name.includes("browser")) return "网页摘要";
  return "运行时工具";
}
