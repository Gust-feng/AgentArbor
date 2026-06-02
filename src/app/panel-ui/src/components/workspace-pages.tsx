import React, { useEffect, useRef, useState } from "react";
import {
  CloudCog,
  Database,
  LayoutList,
  LockKeyhole,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type {
  ConfigResponse,
  ModelProviderModelCatalog,
} from "../contracts/config";
import {
  modelProviderDisplayName,
  resolveModelProviderIdentity,
} from "../model-provider-logos";
import { ModelSettings, type ModelForm } from "./model-settings";
import { SettingRow } from "./workspace-common";
export { SkillsPage } from "./skills-page";
export { ToolsPage, type ToolForm } from "./tools-page";
export type { ModelForm } from "./model-settings";

export type SettingsGroup = "general" | "models" | "workspace" | "confirmation" | "appearance";

export function SettingsDialog(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly config?: ConfigResponse;
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly savingModel?: boolean;
  readonly onSaveModel: (form?: ModelForm) => Promise<void>;
  readonly onCreateCustomProfile: () => void;
  readonly onFetchModels: (profileId?: string) => Promise<ModelProviderModelCatalog | undefined>;
  readonly onSaveModelCatalog: (profileId: string, catalog: ModelProviderModelCatalog) => Promise<void>;
  readonly onRevealModelApiKey: (profileId: string) => Promise<string | undefined>;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly onSaveWorkspace: (workspaceDirectory?: string) => void;
}): React.ReactElement | null {
  const [activeGroup, setActiveGroup] = useState<SettingsGroup>("general");
  useEffect(() => {
    if (props.open) {
      setActiveGroup(props.initialGroup ?? "general");
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
            {activeGroup === "general" && <GeneralSettings config={props.config} />}
            {activeGroup === "models" && (
              <ModelSettings
                config={props.config}
                modelForm={props.modelForm}
                setModelForm={props.setModelForm}
                saving={props.savingModel}
                onSave={props.onSaveModel}
                onCreateCustomProfile={props.onCreateCustomProfile}
                onFetchModels={props.onFetchModels}
                onSaveModelCatalog={props.onSaveModelCatalog}
                onRevealModelApiKey={props.onRevealModelApiKey}
                modelCatalogs={props.modelCatalogs}
              />
            )}
            {activeGroup === "workspace" && (
              <WorkspaceSettings
                workspaceDirectory={props.workspaceDirectory}
                setWorkspaceDirectory={props.setWorkspaceDirectory}
                onSave={props.onSaveWorkspace}
              />
            )}
            {activeGroup === "confirmation" && <ConfirmationSettings />}
            {activeGroup === "appearance" && <AppearanceSettings />}
          </div>
        </div>
      </section>
    </div>
  );
}

function GeneralSettings({ config }: { readonly config?: ConfigResponse }): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>常规</h3>
      <SettingRow label="当前厂商"><span className="settings-value">{visibleConfigProviderTitle(config)}</span></SettingRow>
      <SettingRow label="工具调用"><span className="settings-value">{config?.capabilities?.modelCapabilities?.supportsToolCalling === false ? "当前模型未声明支持" : "按模型能力"}</span></SettingRow>
    </section>
  );
}

function visibleConfigProviderTitle(config: ConfigResponse | undefined): string {
  const activeModel = config?.capabilities?.activeModel;
  const modelConfig = config?.config;
  const identity = resolveModelProviderIdentity({
    title: activeModel?.label ?? modelConfig?.label,
    profileId: modelConfig?.profileId,
    baseUrl: modelConfig?.baseUrl,
    model: modelConfig?.model ?? activeModel?.model,
  });
  return identity === "unknown" ? activeModel?.label ?? modelConfig?.label ?? "未配置" : modelProviderDisplayName(identity);
}

function WorkspaceSettings(props: {
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly onSave: (workspaceDirectory?: string) => void;
}): React.ReactElement {
  const saveTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleWorkspaceSave(nextWorkspaceDirectory: string): void {
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined;
      props.onSave(nextWorkspaceDirectory);
    }, 700);
  }

  return (
    <section className="settings-card">
      <h3>工作目录</h3>
      <SettingRow label="文件夹">
        <input
          value={props.workspaceDirectory}
          onChange={(event) => {
            const nextWorkspaceDirectory = event.target.value;
            props.setWorkspaceDirectory(nextWorkspaceDirectory);
            scheduleWorkspaceSave(nextWorkspaceDirectory);
          }}
        />
      </SettingRow>
      <p>助手只能在授权工作区边界内读取和写入。涉及命令执行或删除文件时仍会请求确认。</p>
    </section>
  );
}

function ConfirmationSettings(): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>确认</h3>
      <SettingRow label="命令执行"><span className="settings-value">需要确认</span></SettingRow>
      <SettingRow label="删除文件"><span className="settings-value">需要确认</span></SettingRow>
      <SettingRow label="创建和编辑文件"><span className="settings-value">工作区内直接执行</span></SettingRow>
    </section>
  );
}

function AppearanceSettings(): React.ReactElement {
  return (
    <section className="settings-card">
      <h3>界面</h3>
      <SettingRow label="密度"><span className="settings-value">标准</span></SettingRow>
      <SettingRow label="动效"><span className="settings-value">跟随系统</span></SettingRow>
    </section>
  );
}

const SETTINGS_GROUPS: readonly { readonly id: SettingsGroup; readonly label: string; readonly icon: React.ReactNode }[] = [
  { id: "general", label: "常规", icon: <SlidersHorizontal size={15} /> },
  { id: "models", label: "模型服务", icon: <CloudCog size={15} /> },
  { id: "confirmation", label: "确认", icon: <LockKeyhole size={15} /> },
  { id: "workspace", label: "数据", icon: <Database size={15} /> },
  { id: "appearance", label: "界面", icon: <LayoutList size={15} /> },
];
