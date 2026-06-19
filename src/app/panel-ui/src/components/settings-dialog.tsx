import React, { useEffect, useState } from "react";
import {
  CloudCog,
  Database,
  FileText,
  Info,
  Palette,
  Server,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  ConfigResponse,
  ModelCapabilities,
  ModelProviderModelCatalog,
} from "../contracts/config";
import type { SkillDefinition } from "../contracts/skills";
import type { McpEnvironmentCheckResponse, McpReferenceResponse, ToolsResponse } from "../contracts/tools";
import { CapabilitiesSettings } from "./capability-settings";
import { ModelSettings } from "./model-settings";
import { SkillSettings } from "./skill-settings";
import { ThemeSwitcher } from "./theme-switcher";
import { getInitialTheme } from "../app-theme";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";
import { WorkspaceSettings } from "./workspace-settings";

export type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSaveCommandShell: (kind: "auto" | "cmd" | "powershell" | "pwsh" | "bash" | "sh") => void;
  readonly savingModelCapabilities?: boolean;
  readonly onSaveModelCapabilities: (capabilities: Partial<ModelCapabilities>) => Promise<void>;
  readonly savingModel?: boolean;
  readonly onSaveModel: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: (form?: ModelForm) => Promise<void>;
  readonly onReorderModelProviders: (order: readonly string[]) => Promise<void>;
  readonly onDeleteModelProvider: (profileId: string, fallbackProfileId?: string) => Promise<void>;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly skills: readonly SkillDefinition[];
  readonly onSaveWorkspace: (workspaceDirectory?: string) => void;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: (form: McpServerForm) => void;
  readonly mcpReferences: Readonly<Record<string, McpReferenceResponse>>;
  readonly savingTools?: boolean;
  readonly onSaveTools: () => void;
  readonly onSaveMcpServer: (form?: McpServerForm) => Promise<void>;
  readonly onLoadMcpReferences: (serverId: string) => void;
  readonly onImportMcpConfig: (config: string) => void;
  readonly onTestMcpServer: (serverId: string) => void;
  readonly onCheckMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onInstallMcpEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onDeleteMcpServer: (serverId: string) => void;
  readonly onUpdateMcpTool: (serverId: string, toolName: string, enabled: boolean, autoApproved?: boolean) => void;
  readonly onRefreshSkills: () => void;
  readonly onUpdateSkill: (skillId: string, enabled: boolean) => void;
}): React.ReactElement | null {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("models");
  useEffect(() => {
    if (props.open) {
      setActiveGroup(props.initialGroup ?? "models");
    }
  }, [props.open, props.initialGroup]);

  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  useEffect(() => {
    if (!props.open) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
    };
  }, [props.open]);

  if (!props.open) return null;

  const activeInfo = SETTINGS_GROUPS.find((group) => group.id === activeGroup) ?? SETTINGS_GROUPS[0]!;
  return (
    <div className="settings-overlay" role="dialog" aria-modal="true" aria-label="设置">
      <button type="button" className="settings-backdrop" aria-label="关闭设置" onClick={props.onClose} />
      <section className="settings-dialog">
        <aside className="settings-sidebar">
          <button type="button" className="settings-close-button" onClick={props.onClose} aria-label="关闭">
            <X size={16} />
          </button>
          <nav aria-label="设置分组">
            {SETTINGS_GROUPS.map((group) => (
              <button
                type="button"
                key={group.id}
                className={group.id === activeGroup ? "active" : ""}
                onClick={() => setActiveGroup(group.id)}
              >
                {group.icon}
                <span>{group.label}</span>
              </button>
            ))}
          </nav>
        </aside>
        <div className="settings-main">
          <header>
            <h2>{activeInfo.label}</h2>
          </header>
          <div className={`settings-content ${activeGroup === "models" ? "model-settings-content" : ""}`}>
            {activeGroup === "models" && (
              <ModelSettings
                config={props.config}
                modelForm={props.modelForm}
                setModelForm={props.setModelForm}
                saving={props.savingModel}
                onSave={props.onSaveModel}
                onCreateCustomProfile={props.onCreateCustomProfile}
                onReorderModelProviders={props.onReorderModelProviders}
                onDeleteModelProvider={props.onDeleteModelProvider}
                onFetchModels={props.onFetchModels}
                onSaveModelCatalog={props.onSaveModelCatalog}
                onRevealModelApiKey={props.onRevealModelApiKey}
                modelCatalogs={props.modelCatalogs}
              />
            )}
            {(activeGroup === "capabilities" || activeGroup === "mcp") && (
              <CapabilitiesSettings
                activeSection={activeGroup}
                config={props.config}
                tools={props.tools}
                toolForm={props.toolForm}
                setToolForm={props.setToolForm}
                savingModelCapabilities={props.savingModelCapabilities}
                onSaveModelCapabilities={props.onSaveModelCapabilities}
                mcpServerForm={props.mcpServerForm}
                setMcpServerForm={props.setMcpServerForm}
                mcpReferences={props.mcpReferences}
                savingTools={props.savingTools}
                onSaveTools={props.onSaveTools}
                onSaveMcpServer={props.onSaveMcpServer}
                onLoadMcpReferences={props.onLoadMcpReferences}
                onImportMcpConfig={props.onImportMcpConfig}
                onTestMcpServer={props.onTestMcpServer}
                onCheckMcpEnvironment={props.onCheckMcpEnvironment}
                onInstallMcpEnvironment={props.onInstallMcpEnvironment}
                onDeleteMcpServer={props.onDeleteMcpServer}
                onUpdateMcpTool={props.onUpdateMcpTool}
              />
            )}
            {activeGroup === "skills" && (
              <SkillSettings
                skills={props.skills}
                saving={props.savingTools}
                onRefreshSkills={props.onRefreshSkills}
                onUpdateSkill={props.onUpdateSkill}
              />
            )}
            {activeGroup === "workspace" && (
              <WorkspaceSettings
                commandShell={props.config?.commandShell}
                workspaceDirectory={props.workspaceDirectory}
                setWorkspaceDirectory={props.setWorkspaceDirectory}
                onSave={props.onSaveWorkspace}
                onSaveCommandShell={props.onSaveCommandShell}
              />
            )}
            {activeGroup === "appearance" && <AppearanceSettings config={props.config} />}
            {activeGroup === "about" && <AboutSettings config={props.config} />}
          </div>
        </div>
      </section>
    </div>
  );
}

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string; readonly icon: React.ReactNode }[] = [
  { id: "models", label: "模型服务", icon: <CloudCog size={15} /> },
  { id: "capabilities", label: "基础能力", icon: <SlidersHorizontal size={15} /> },
  { id: "mcp", label: "MCP 服务", icon: <Server size={15} /> },
  { id: "skills", label: "技能", icon: <FileText size={15} /> },
  { id: "workspace", label: "工作区", icon: <Database size={15} /> },
  { id: "appearance", label: "外观", icon: <Palette size={15} /> },
  { id: "about", label: "关于", icon: <Info size={15} /> },
];

function AppearanceSettings(props: { readonly config?: ConfigResponse }): React.ReactElement {
  const browserAppearance = useBrowserAppearanceSnapshot();
  const configuredAppearance = props.config?.appearance;
  const documentColorScheme = configuredAppearance?.colorScheme ?? browserAppearance.documentColorScheme;
  const [initialTheme] = useState(() => getInitialTheme());
  const [currentStyleId, setCurrentStyleId] = useState(initialTheme.styleId);
  const [currentColorId, setCurrentColorId] = useState(initialTheme.colorId);
  return (
    <div className="workspace-settings-stack">
      <ThemeSwitcher
        activeStyleId={currentStyleId}
        activeColorId={currentColorId}
        onStyleChange={setCurrentStyleId}
        onColorChange={setCurrentColorId}
      />
      <section className="settings-card">
        <h3>当前环境</h3>
        <div className="settings-row">
          <span>主题来源</span>
          <div><span className="settings-value">本机偏好，立即生效</span></div>
        </div>
        <div className="settings-row">
          <span>文档色彩方案</span>
          <div><span className="settings-value">{colorSchemeLabel(documentColorScheme)}</span></div>
        </div>
        <div className="settings-row">
          <span>系统偏好</span>
          <div><span className="settings-value">{colorSchemeLabel(browserAppearance.systemColorPreference)}</span></div>
        </div>
        <div className="settings-row">
          <span>界面密度</span>
          <div><span className="settings-value">{configuredAppearance?.densityLabel ?? "标准"}</span></div>
        </div>
      </section>
    </div>
  );
}

function AboutSettings(props: { readonly config?: ConfigResponse }): React.ReactElement {
  const product = props.config?.product;
  return (
    <div className="workspace-settings-stack">
      <section className="settings-card">
        <h3>{product?.name ?? "AgentArbor"}</h3>
        <p>桌面通用 Agent 工作台。</p>
        <div className="settings-row">
          <span>版本</span>
          <div><span className="settings-value">{product?.version ?? "未提供"}</span></div>
        </div>
        <div className="settings-row">
          <span>默认入口</span>
          <div><span className="settings-value">{product?.defaultEntry ?? "Desktop Shell / Panel"}</span></div>
        </div>
        <div className="settings-row">
          <span>默认运行模式</span>
          <div><span className="settings-value">{product?.runtimeModeLabel ?? "普通 agent"}</span></div>
        </div>
        <div className="settings-row">
          <span>配置目录</span>
          <div><span className="settings-value">{product?.configDirectory ?? "未提供"}</span></div>
        </div>
        <div className="settings-row">
          <span>运行数据目录</span>
          <div><span className="settings-value">{product?.runtimeDirectory ?? "未提供"}</span></div>
        </div>
      </section>
    </div>
  );
}

type BrowserAppearanceSnapshot = {
  readonly documentColorScheme: string;
  readonly systemColorPreference: "light" | "dark" | "unknown";
};

function useBrowserAppearanceSnapshot(): BrowserAppearanceSnapshot {
  const [snapshot, setSnapshot] = useState<BrowserAppearanceSnapshot>(() => readBrowserAppearanceSnapshot());
  useEffect(() => {
    setSnapshot(readBrowserAppearanceSnapshot());
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setSnapshot(readBrowserAppearanceSnapshot());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return snapshot;
}

function readBrowserAppearanceSnapshot(): BrowserAppearanceSnapshot {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { documentColorScheme: "unknown", systemColorPreference: "unknown" };
  }
  const documentColorScheme = window.getComputedStyle(document.documentElement).colorScheme.trim() || "unknown";
  const systemColorPreference = typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  return { documentColorScheme, systemColorPreference };
}

function colorSchemeLabel(value: string | undefined): string {
  if (value === "light") return "浅色";
  if (value === "dark") return "深色";
  if (value === undefined || value === "unknown") return "未声明";
  return value;
}
