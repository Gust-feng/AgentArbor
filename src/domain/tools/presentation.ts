import type {
  ToolCategory,
  ToolDefinition,
  ToolDefinitionMetadata,
  ToolOperationType,
  ToolRiskLevel,
} from "./contracts.js";

export type ToolPresentation = {
  readonly displayName: string;
  readonly displayDescription: string;
  readonly categoryLabel: string;
  readonly operationLabel: string;
  readonly riskLabel: string;
  readonly confirmationLabel: string;
};

type ToolPresentationSeed = {
  readonly displayName: string;
  readonly displayDescription: string;
};

const BUILTIN_TOOL_PRESENTATION: Readonly<Record<string, ToolPresentationSeed>> = {
  search: {
    displayName: "资料搜索",
    displayDescription: "在已配置的信息源中检索资料，返回可引用的资料摘要。",
  },
  read: {
    displayName: "资料读取",
    displayDescription: "读取检索结果或资料引用内容，用于补充上下文。",
  },
  web_search: {
    displayName: "网页搜索",
    displayDescription: "通过已配置的搜索服务获取外部网页资料摘要。",
  },
  browser_snapshot: {
    displayName: "浏览网页",
    displayDescription: "打开网页并返回文本快照，适合网页阅读和事实核对。",
  },
  read_file: {
    displayName: "读取文件",
    displayDescription: "读取授权工作区内的文本文件，用于理解项目上下文。",
  },
  list_dir: {
    displayName: "浏览目录",
    displayDescription: "查看工作区目录结构，帮助定位相关文件。",
  },
  grep_files: {
    displayName: "搜索文件",
    displayDescription: "在本地工作区搜索文本，返回匹配文件、行号和片段。",
  },
  create_file: {
    displayName: "创建文件",
    displayDescription: "在当前工作区创建不存在的 UTF-8 文本文件，不覆盖已有文件。",
  },
  edit_file: {
    displayName: "编辑文件",
    displayDescription: "按唯一锚点原子修改工作区文本文件，并返回变更摘要。",
  },
  delete_file: {
    displayName: "删除文件",
    displayDescription: "删除工作区内指定文件。",
  },
  write_file: {
    displayName: "写入文件",
    displayDescription: "兼容写入能力；普通 Agent 默认不展示覆盖式写入工具。",
  },
  run_command: {
    displayName: "运行命令",
    displayDescription: "在工作区内运行命令。",
  },
  shell_command: {
    displayName: "执行 Shell",
    displayDescription: "在工作区内执行 Shell 命令。",
  },
};

export function toolPresentationForDefinition(definition: ToolDefinition): ToolPresentation {
  return toolPresentationForName(definition.name, definition.metadata, definition.description);
}

export function toolPresentationForName(
  name: string,
  metadata?: ToolDefinitionMetadata,
  description?: string
): ToolPresentation {
  const seed = BUILTIN_TOOL_PRESENTATION[name] ?? fallbackPresentation(metadata);
  return {
    displayName: seed.displayName,
    displayDescription: seed.displayDescription || description || "可供 Agent 在授权边界内调用的工具能力。",
    categoryLabel: toolCategoryLabel(metadata?.category),
    operationLabel: toolOperationLabel(metadata?.operationType),
    riskLabel: toolRiskLabel(metadata?.riskLevel),
    confirmationLabel: metadata?.requiresConfirmation === true ? "执行前确认" : "自动执行",
  };
}

export function toolDisplayName(name: string, metadata?: ToolDefinitionMetadata): string {
  return toolPresentationForName(name, metadata).displayName;
}

export function toolCategoryLabel(category: ToolCategory | undefined): string {
  switch (category) {
    case "research":
      return "资料检索";
    case "workspace":
      return "工作区";
    case "filesystem":
      return "文件系统";
    case "terminal":
      return "终端命令";
    case "web":
      return "网页访问";
    case "mcp":
      return "扩展协议";
    case "other":
    case undefined:
      return "其他能力";
  }
}

export function toolOperationLabel(operation: ToolOperationType | undefined): string {
  switch (operation) {
    case "read-only":
      return "只读";
    case "read-write":
      return "读写";
    case "execute":
      return "执行";
    case "external-submit":
      return "外部提交";
    case undefined:
      return "未声明";
  }
}

export function toolRiskLabel(risk: ToolRiskLevel | undefined): string {
  switch (risk) {
    case "low":
      return "低风险";
    case "medium":
      return "中风险";
    case "high":
      return "高风险";
    case undefined:
      return "风险未声明";
  }
}

function fallbackPresentation(metadata: ToolDefinitionMetadata | undefined): ToolPresentationSeed {
  if (metadata?.category === "filesystem") {
    return {
      displayName: "文件工具",
      displayDescription: "在工作区文件边界内读取或修改文件。",
    };
  }
  if (metadata?.category === "terminal") {
    return {
      displayName: "终端工具",
      displayDescription: "在工作区执行终端相关操作。",
    };
  }
  if (metadata?.category === "web" || metadata?.category === "research") {
    return {
      displayName: "资料工具",
      displayDescription: "读取或检索外部资料，并返回资料摘要。",
    };
  }
  if (metadata?.category === "mcp") {
    return {
      displayName: "扩展工具",
      displayDescription: "由外部扩展协议提供的工具能力。",
    };
  }
  return {
    displayName: "工具能力",
    displayDescription: "可供 Agent 在授权边界内调用的工具能力。",
  };
}
