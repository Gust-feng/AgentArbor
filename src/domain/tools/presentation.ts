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

export type CommandTextLike = {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly commandLine?: string;
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
    displayDescription: "打开网页并返回文本快照。",
  },
  http_request: {
    displayName: "HTTP 请求",
    displayDescription: "发送 HTTP/HTTPS 请求并返回状态、响应头和有上限的响应体。",
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
  list_context_attachments: {
    displayName: "查看附件",
    displayDescription: "列出本轮用户提供的上下文附件引用和元数据。",
  },
  read_context_attachment_text: {
    displayName: "读取附件文本",
    displayDescription: "按附件引用读取文本文件或附件项目中的文本文件。",
  },
  read_context_attachment_pdf_text: {
    displayName: "读取附件 PDF 文本",
    displayDescription: "按附件引用从文本型 PDF 中尽力抽取正文，不处理 OCR。",
  },
  read_context_attachment_image: {
    displayName: "读取附件图片",
    displayDescription: "按附件引用把图片作为本轮模型视觉输入读取。",
  },
  inspect_context_attachment_table: {
    displayName: "检查附件表格",
    displayDescription: "按附件引用识别 CSV/TSV/XLSX 表格列、行数、sheet 和样例行。",
  },
  read_context_attachment_table: {
    displayName: "读取附件表格",
    displayDescription: "按附件引用读取 CSV/TSV/XLSX 表格的指定行窗口。",
  },
  inspect_context_attachment_archive: {
    displayName: "检查附件压缩包",
    displayDescription: "按附件引用列出 ZIP 压缩包内部条目，不解压文件。",
  },
  list_context_attachment_files: {
    displayName: "浏览附件目录",
    displayDescription: "按附件引用浏览用户提供的项目文件夹结构。",
  },
  search_context_attachment_files: {
    displayName: "搜索附件文件",
    displayDescription: "按附件引用在用户提供的文件或项目中搜索文本。",
  },
  create_file: {
    displayName: "创建文件",
    displayDescription: "在当前工作区创建不存在的 UTF-8 文本文件，不覆盖已有文件。",
  },
  edit_file: {
    displayName: "编辑文件",
    displayDescription: "精确修改工作区文本文件，并返回变更摘要。",
  },
  delete_file: {
    displayName: "删除文件",
    displayDescription: "删除工作区内指定文件。",
  },
  write_file: {
    displayName: "写入文件",
    displayDescription: "写入工作区文本文件。",
  },
  run_command: {
    displayName: "运行命令",
    displayDescription: "兼容旧命令入口，保留给历史运行与旧提示词。",
  },
  shell_command: {
    displayName: "Shell 命令",
    displayDescription: "在当前会话 Shell 中运行命令，并把结果原样返回给模型。",
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
    displayDescription: seed.displayDescription || description || "运行时工具。",
    categoryLabel: toolCategoryLabel(metadata?.category),
    operationLabel: toolOperationLabel(metadata?.operationType),
    riskLabel: toolRiskLabel(metadata?.riskLevel),
    confirmationLabel: metadata?.requiresConfirmation === true ? "需确认" : "可用",
  };
}

export function toolDisplayName(name: string, metadata?: ToolDefinitionMetadata): string {
  return toolPresentationForName(name, metadata).displayName;
}

export function commandDisplayText(display: CommandTextLike): string | undefined {
  if (typeof display.commandLine === "string" && display.commandLine.trim().length > 0) {
    return display.commandLine.trim();
  }
  const parts = [display.command, ...(display.args ?? [])]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return parts.length === 0 ? undefined : parts.join(" ");
}

export function commandTextFromValue(value: unknown, fallback?: unknown): string | undefined {
  const primary = asRecord(value);
  const secondary = asRecord(fallback);
  const commandLine =
    stringOrUndefined(primary.commandLine) ??
    stringOrUndefined(secondary.commandLine);
  if (commandLine !== undefined) {
    return commandLine;
  }
  const command =
    stringOrUndefined(primary.command) ??
    stringOrUndefined(secondary.command);
  if (command === undefined) {
    return undefined;
  }
  const primaryArgs = stringArray(primary.args);
  const args = primaryArgs.length > 0 ? primaryArgs : stringArray(secondary.args);
  return [command, ...args].join(" ").trim();
}

export function commandProgramFromValue(value: unknown, fallback?: unknown): string | undefined {
  const primary = asRecord(value);
  const secondary = asRecord(fallback);
  return stringOrUndefined(primary.command)
    ?? stringOrUndefined(secondary.command)
    ?? commandTextFromValue(primary, secondary);
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
    displayDescription: "运行时工具。",
  };
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
