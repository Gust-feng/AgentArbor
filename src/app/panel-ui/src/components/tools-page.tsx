import React, { useMemo, useState } from "react";
import {
  FileSearch,
  Globe2,
  Plus,
  Wrench,
} from "lucide-react";
import type { ToolCatalogItem, ToolsResponse } from "../contracts/tools";
import { EmptyBlock, IconTile, PageHeader, Pill, TabBar, Toggle } from "./workspace-common";

export type ToolForm = {
  readonly provider: string;
  readonly tavilyApiKey: string;
  readonly maxResults: string;
};

const TOOL_TABS = ["全部", "已启用", "本地", "需要确认"] as const;
const SAVED_API_KEY_MASK = "****************";

export function ToolsPage(props: {
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
}): React.ReactElement {
  const [activeTab, setActiveTab] = useState<(typeof TOOL_TABS)[number]>("全部");
  const [configOpen, setConfigOpen] = useState(false);
  const catalog = props.tools?.tools?.catalog?.tools ?? [];
  const visibleTools = useMemo(() => filterTools(catalog, activeTab), [catalog, activeTab]);
  return (
    <section className="workspace-page" aria-label="工具">
      <div className="workspace-shell">
        <PageHeader
          title="工具"
          subtitle="管理助手可调用的本地与网络能力"
          actions={
            <button type="button" className="page-action-button" onClick={() => setConfigOpen((value) => !value)}>
              <Plus size={14} />
              接入工具
            </button>
          }
        />
        <TabBar tabs={TOOL_TABS} activeTab={activeTab} onChange={setActiveTab} />
        <section className="tools-table">
          <WebSearchRow
            open={configOpen}
            onToggle={() => setConfigOpen((value) => !value)}
            tools={props.tools}
            toolForm={props.toolForm}
            setToolForm={props.setToolForm}
            saving={props.saving}
            onSaveTools={props.onSaveTools}
          />
          {visibleTools.length === 0 ? (
            <EmptyBlock>当前没有可展示的工具。</EmptyBlock>
          ) : (
            visibleTools.map((tool) => (
              <ToolRow tool={tool} onUpdateTool={props.onUpdateTool} key={tool.name} />
            ))
          )}
        </section>
      </div>
    </section>
  );
}

function WebSearchRow(props: {
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const configured = props.tools?.tools?.webSearch?.secretConfigured === true;
  const current = props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider;
  return (
    <article className="tool-row web-search-row">
      <div className="tool-main">
        <IconTile icon={<Globe2 size={17} />} />
        <div>
          <h2>网页搜索</h2>
          <p>当前服务：{providerName(current)}。用于搜索网页资料并返回资料摘要。</p>
        </div>
      </div>
      <div className="tool-meta">
        <Pill tone={configured ? "success" : "neutral"}>{configured ? "已配置" : "待配置"}</Pill>
        <span>网络资料</span>
      </div>
      <div className="tool-actions">
        <button type="button" onClick={props.onToggle}>{props.open ? "收起" : "配置"}</button>
      </div>
      {props.open && (
        <div className="tool-config-panel">
          <label>
            搜索服务
            <select value={props.toolForm.provider} onChange={(event) => props.setToolForm({ ...props.toolForm, provider: event.target.value })}>
              <option value="tavily">Tavily</option>
              <option value="none">无</option>
            </select>
          </label>
          <label>
            Tavily Key
            <input
              type="password"
              value={props.toolForm.tavilyApiKey}
              onChange={(event) => props.setToolForm({ ...props.toolForm, tavilyApiKey: event.target.value })}
              placeholder={configured ? SAVED_API_KEY_MASK : "请输入密钥"}
            />
          </label>
          <label>
            结果数
            <input
              type="number"
              min={1}
              max={10}
              value={props.toolForm.maxResults}
              onChange={(event) => props.setToolForm({ ...props.toolForm, maxResults: event.target.value })}
            />
          </label>
          <button type="button" className="page-action-button primary" onClick={props.onSaveTools} disabled={props.saving}>
            {props.saving ? "保存中" : "保存"}
          </button>
        </div>
      )}
    </article>
  );
}

function ToolRow(props: {
  readonly tool: ToolCatalogItem;
  readonly onUpdateTool: (toolName: string, enabled: boolean) => void;
}): React.ReactElement {
  const copy = toolCopy(props.tool);
  const enabled = props.tool.enabled && props.tool.available !== false;
  return (
    <article className="tool-row">
      <div className="tool-main">
        <IconTile icon={toolIcon(props.tool)} />
        <div>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
      </div>
      <div className="tool-meta">
        <Pill tone={enabled ? "success" : "neutral"}>{enabled ? "可用" : "不可用"}</Pill>
        <span>{toolMeta(props.tool)}</span>
      </div>
      <div className="tool-actions">
        <Toggle checked={props.tool.enabled} onChange={(checked) => props.onUpdateTool(props.tool.name, checked)} label={`${copy.title}开关`} />
      </div>
    </article>
  );
}

function filterTools(catalog: readonly ToolCatalogItem[], tab: (typeof TOOL_TABS)[number]): readonly ToolCatalogItem[] {
  if (tab === "已启用") return catalog.filter((tool) => tool.enabled && tool.available !== false);
  if (tab === "本地") return catalog.filter((tool) => tool.category === "filesystem" || tool.category === "terminal" || tool.category === "workspace");
  if (tab === "需要确认") return catalog.filter((tool) => tool.requiresConfirmation === true || tool.riskLevel === "high");
  return catalog;
}

function toolCopy(tool: ToolCatalogItem): { readonly title: string; readonly description: string } {
  return {
    title: tool.displayName ?? fallbackToolName(tool.name),
    description: tool.displayDescription ?? tool.description ?? "可供助手在授权边界内调用的能力。",
  };
}

function toolMeta(tool: ToolCatalogItem): string {
  if (tool.requiresConfirmation === true || tool.riskLevel === "high") return tool.confirmationLabel ?? "需确认";
  return [tool.categoryLabel, tool.operationLabel].filter((item): item is string => typeof item === "string" && item.length > 0).join(" · ") || "工具能力";
}

function toolIcon(tool: ToolCatalogItem): React.ReactNode {
  if (tool.category === "filesystem" || tool.name.includes("file")) return <FileSearch size={17} />;
  if (tool.category === "terminal" || tool.name.includes("command")) return <Wrench size={17} />;
  if (tool.category === "web" || tool.name.includes("search") || tool.name.includes("browser")) return <Globe2 size={17} />;
  return <Wrench size={17} />;
}

function fallbackToolName(name: string): string {
  if (name.includes("read_file")) return "读取文件";
  if (name.includes("create_file")) return "创建文件";
  if (name.includes("edit_file")) return "编辑文件";
  if (name.includes("delete_file")) return "删除文件";
  if (name.includes("shell") || name.includes("command")) return "命令执行";
  if (name.includes("search")) return "网页搜索";
  if (name.includes("browser")) return "网页摘要";
  return "工具能力";
}

function providerName(value: string): string {
  if (value === "tavily") return "Tavily";
  if (value === "none") return "未启用";
  return value;
}
