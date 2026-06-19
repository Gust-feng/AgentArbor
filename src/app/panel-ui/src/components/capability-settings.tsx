import React from "react";
import { Link2, Plus, Save, Trash2, X } from "lucide-react";
import type { ConfigResponse, ModelCapabilities } from "../contracts/config";
import type { McpEnvironmentCheckResponse, McpReferenceResponse, ToolsResponse } from "../contracts/tools";
import type { McpServerForm, ToolForm } from "./settings-types";
import { providerName } from "./settings-tool-copy";
import { SettingRow } from "./workspace-common";

const SAVED_API_KEY_MASK = "****************";
type McpCatalogServer = NonNullable<ToolsResponse["mcpCatalog"]>[number];
type SettingsSelectOption = {
  readonly value: string;
  readonly label: string;
};

export function CapabilitiesSettings(props: {
  readonly activeSection?: "capabilities" | "mcp";
  readonly config?: ConfigResponse;
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly savingModelCapabilities?: boolean;
  readonly onSaveModelCapabilities: (capabilities: Partial<ModelCapabilities>) => Promise<void>;
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
}): React.ReactElement {
  if (props.activeSection === "mcp") {
    return (
      <McpServiceSettings
        tools={props.tools}
        form={props.mcpServerForm}
        setForm={props.setMcpServerForm}
        saving={props.savingTools}
        onSave={props.onSaveMcpServer}
        onImport={props.onImportMcpConfig}
        onTest={props.onTestMcpServer}
        onCheckEnvironment={props.onCheckMcpEnvironment}
        onInstallEnvironment={props.onInstallMcpEnvironment}
        onDelete={props.onDeleteMcpServer}
        onUpdateTool={props.onUpdateMcpTool}
      />
    );
  }
  return (
    <div className="capability-settings-stack">
      <ModelCapabilitySettings
        config={props.config}
        saving={props.savingModelCapabilities}
        onSave={props.onSaveModelCapabilities}
      />
      <WebSearchSettings
        tools={props.tools}
        toolForm={props.toolForm}
        setToolForm={props.setToolForm}
        saving={props.savingTools}
        onSaveTools={props.onSaveTools}
      />
    </div>
  );
}

type ModelCapabilityDraft = {
  readonly contextWindowTokens: string;
  readonly maxOutputTokens: string;
  readonly supportsToolCalling: boolean;
  readonly supportsParallelToolCalls: boolean;
  readonly supportsStructuredOutputs: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsVisionInput: boolean;
  readonly supportsReasoningEffort: boolean;
  readonly supportsReasoningOutput: boolean;
};

function ModelCapabilitySettings(props: {
  readonly config?: ConfigResponse;
  readonly saving?: boolean;
  readonly onSave: (capabilities: Partial<ModelCapabilities>) => Promise<void>;
}): React.ReactElement {
  const capabilities = props.config?.capabilities?.modelCapabilities;
  const activeModel = props.config?.capabilities?.activeModel ?? props.config?.config;
  const modelName = activeModel?.model ?? props.config?.config?.model;
  const [draft, setDraft] = React.useState<ModelCapabilityDraft>(() => capabilityDraftFromConfig(capabilities));

  React.useEffect(() => {
    setDraft(capabilityDraftFromConfig(capabilities));
  }, [
    capabilities?.contextWindowTokens,
    capabilities?.maxOutputTokens,
    capabilities?.supportsToolCalling,
    capabilities?.supportsParallelToolCalls,
    capabilities?.supportsStructuredOutputs,
    capabilities?.supportsStreaming,
    capabilities?.supportsVisionInput,
    capabilities?.supportsReasoningEffort,
    capabilities?.supportsReasoningOutput,
  ]);

  const canSave = modelName !== undefined && modelName.trim().length > 0 && props.saving !== true;
  const save = async (): Promise<void> => {
    if (!canSave) return;
    await props.onSave(capabilitiesFromDraft(draft));
  };

  return (
    <section className="settings-card model-capability-card">
      <div className="settings-card-title-row">
        <h3>模型能力</h3>
        <button
          type="button"
          className="page-action-button primary capability-save-button"
          onClick={() => void save()}
          disabled={!canSave}
        >
          <Save size={14} />
          {props.saving ? "保存中" : "保存"}
        </button>
      </div>
      <div className="model-capability-grid">
        <SettingRow label="当前模型">
          <span className="settings-value">{modelName ?? "未填写"}</span>
        </SettingRow>
        <SettingRow label="上下文窗口">
          <CapabilityNumberInput
            value={draft.contextWindowTokens}
            onChange={(value) => setDraft({ ...draft, contextWindowTokens: value })}
            disabled={props.saving}
            ariaLabel="上下文窗口"
          />
        </SettingRow>
        <SettingRow label="最大输出">
          <CapabilityNumberInput
            value={draft.maxOutputTokens}
            onChange={(value) => setDraft({ ...draft, maxOutputTokens: value })}
            disabled={props.saving}
            ariaLabel="最大输出"
          />
        </SettingRow>
        <CapabilityToggleRow
          label="工具调用"
          pressed={draft.supportsToolCalling}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsToolCalling: !draft.supportsToolCalling })}
        />
        <CapabilityToggleRow
          label="并行工具"
          pressed={draft.supportsParallelToolCalls}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsParallelToolCalls: !draft.supportsParallelToolCalls })}
        />
        <CapabilityToggleRow
          label="结构化输出"
          pressed={draft.supportsStructuredOutputs}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsStructuredOutputs: !draft.supportsStructuredOutputs })}
        />
        <CapabilityToggleRow
          label="流式输出"
          pressed={draft.supportsStreaming}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsStreaming: !draft.supportsStreaming })}
        />
        <CapabilityToggleRow
          label="视觉输入"
          pressed={draft.supportsVisionInput}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsVisionInput: !draft.supportsVisionInput })}
        />
        <CapabilityToggleRow
          label="思考强度"
          pressed={draft.supportsReasoningEffort}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsReasoningEffort: !draft.supportsReasoningEffort })}
        />
        <CapabilityToggleRow
          label="思考输出"
          pressed={draft.supportsReasoningOutput}
          disabled={props.saving}
          onToggle={() => setDraft({ ...draft, supportsReasoningOutput: !draft.supportsReasoningOutput })}
        />
      </div>
      {props.config?.capabilities?.warnings !== undefined && props.config.capabilities.warnings.length > 0 && (
        <div className="capability-warning-list">
          {props.config.capabilities.warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function CapabilityNumberInput(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly ariaLabel: string;
}): React.ReactElement {
  return (
    <input
      className="capability-number-input"
      type="number"
      min={1}
      value={props.value}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function CapabilityToggleRow(props: {
  readonly label: string;
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onToggle: () => void;
}): React.ReactElement {
  return (
    <SettingRow label={props.label}>
      <button
        type="button"
        className="capability-toggle"
        aria-pressed={props.pressed}
        disabled={props.disabled}
        onClick={props.onToggle}
      >
        {props.pressed ? "开启" : "关闭"}
      </button>
    </SettingRow>
  );
}

function capabilityDraftFromConfig(capabilities: ModelCapabilities | undefined): ModelCapabilityDraft {
  return {
    contextWindowTokens: stringFromPositiveInteger(capabilities?.contextWindowTokens),
    maxOutputTokens: stringFromPositiveInteger(capabilities?.maxOutputTokens),
    supportsToolCalling: capabilities?.supportsToolCalling === true,
    supportsParallelToolCalls: capabilities?.supportsParallelToolCalls === true,
    supportsStructuredOutputs: capabilities?.supportsStructuredOutputs === true,
    supportsStreaming: capabilities?.supportsStreaming === true,
    supportsVisionInput: capabilities?.supportsVisionInput === true,
    supportsReasoningEffort: capabilities?.supportsReasoningEffort === true,
    supportsReasoningOutput: capabilities?.supportsReasoningOutput === true,
  };
}

function capabilitiesFromDraft(draft: ModelCapabilityDraft): Partial<ModelCapabilities> {
  return {
    contextWindowTokens: positiveIntegerFromString(draft.contextWindowTokens),
    maxOutputTokens: positiveIntegerFromString(draft.maxOutputTokens),
    supportsToolCalling: draft.supportsToolCalling,
    supportsParallelToolCalls: draft.supportsParallelToolCalls,
    supportsStructuredOutputs: draft.supportsStructuredOutputs,
    supportsStreaming: draft.supportsStreaming,
    supportsVisionInput: draft.supportsVisionInput,
    supportsReasoningEffort: draft.supportsReasoningEffort,
    supportsReasoningOutput: draft.supportsReasoningOutput,
    lastVerifiedAt: new Date().toISOString().slice(0, 10),
  };
}

function stringFromPositiveInteger(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : "";
}

function positiveIntegerFromString(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function WebSearchSettings(props: {
  readonly tools?: ToolsResponse;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly saving?: boolean;
  readonly onSaveTools: () => void;
}): React.ReactElement {
  const configured = props.tools?.tools?.webSearch?.secretConfigured === true;
  const current = props.tools?.tools?.webSearch?.provider ?? props.toolForm.provider;
  return (
    <section className="settings-card service-settings-card">
      <h3>网页查证</h3>
      <div className="service-config-grid">
        <label>
          搜索服务
          <SettingsSelectControl
            id="web-search-provider"
            ariaLabel="搜索服务"
            value={props.toolForm.provider}
            options={[
              { value: "tavily", label: "Tavily" },
              { value: "none", label: "无" },
            ]}
            onChange={(value) => props.setToolForm({ ...props.toolForm, provider: value })}
          />
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
    </section>
  );
}

function McpServiceSettings(props: {
  readonly tools?: ToolsResponse;
  readonly form: McpServerForm;
  readonly setForm: (form: McpServerForm) => void;
  readonly saving?: boolean;
  readonly onSave: (form?: McpServerForm) => Promise<void>;
  readonly onImport: (config: string) => void;
  readonly onTest: (serverId: string) => void;
  readonly onCheckEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onInstallEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onDelete: (serverId: string) => void;
  readonly onUpdateTool: (serverId: string, toolName: string, enabled: boolean, autoApproved?: boolean) => void;
}): React.ReactElement {
  const [importText, setImportText] = React.useState("");
  const [panelMode, setPanelMode] = React.useState<"overview" | "edit" | "add">("overview");
  const catalog = props.tools?.mcpCatalog ?? [];
  const selectedServer = panelMode === "add" || props.form.serverId.length === 0
    ? undefined
    : catalog.find((server) => server.serverId === props.form.serverId);
  const editingServer = panelMode === "edit" && selectedServer !== undefined;
  const addingServer = panelMode === "add";
  const saveServer = async (form: McpServerForm = props.form): Promise<void> => {
    const nextForm = formWithDerivedServerId(form);
    if (!canSaveMcpServerForm(nextForm)) return;
    try {
      props.setForm(nextForm);
      await props.onSave(nextForm);
      if (addingServer) {
        setPanelMode("edit");
      }
    } catch {
      // The settings controller already publishes the visible error.
    }
  };
  const saveAndTestServer = async (form: McpServerForm = props.form): Promise<void> => {
    const nextForm = formWithDerivedServerId(form);
    const serverId = effectiveMcpServerId(nextForm);
    if (serverId.length === 0 || !canTestMcpServerForm(nextForm)) return;
    try {
      props.setForm(nextForm);
      await props.onSave(nextForm);
      setPanelMode("edit");
      props.onTest(serverId);
    } catch {
      // The settings controller already publishes the visible error.
    }
  };
  return (
    <section className="mcp-board">
      <header className="mcp-board-header">
        <div>
          <div className="mcp-board-title-row">
            <h3>已连接服务</h3>
            <span>{catalog.length}</span>
          </div>
        </div>
        <button
          type="button"
          className="mcp-connect-button"
          onClick={() => {
            props.setForm(emptyMcpServerForm());
            setPanelMode("add");
          }}
          disabled={props.saving}
        >
          <Plus size={14} />
          连接工具
        </button>
      </header>
      <div className="mcp-service-card-grid" aria-label="MCP 服务列表">
        {catalog.length === 0 ? (
          <div className="mcp-service-empty">暂无服务</div>
        ) : catalog.map((server) => {
          const selected = panelMode === "edit" && server.serverId === props.form.serverId;
          const serverStatus = mcpRuntimeStatusLabel(server.runtimeStatus ?? server.availability);
          const serverError = mcpCompactError(server.errorSummary ?? server.lastError);
          return (
            <button
              type="button"
              key={server.serverId}
              className={`mcp-service-card ${selected ? "selected" : ""}`}
              onClick={() => {
                props.setForm(formFromMcpCatalog(server, props.form));
                setPanelMode("edit");
              }}
            >
              <span className="mcp-service-card-top">
                <span className="mcp-service-card-title">
                  <strong>{server.label}</strong>
                  <span>{transportLabel(server.transport)}</span>
                </span>
                <span className={`mcp-status-pill ${mcpStatusTone(server.runtimeStatus ?? server.availability)}`}>{serverStatus}</span>
              </span>
              <span className="mcp-service-card-command">{mcpServerCardCommand(server)}</span>
              <span className="mcp-service-card-footer">
                {mcpServerCardFacts(server).map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </span>
              {serverError !== undefined && <span className="mcp-service-card-error">错误：{serverError}</span>}
            </button>
          );
        })}
      </div>
      {editingServer && selectedServer !== undefined && (
        <McpServerPanel
          mode="edit"
          form={props.form}
          setForm={props.setForm}
          selectedServer={selectedServer}
          saving={props.saving}
          importText={importText}
          setImportText={setImportText}
          onImport={props.onImport}
          onSave={saveServer}
          onSaveAndTest={saveAndTestServer}
          onCheckEnvironment={props.onCheckEnvironment}
          onInstallEnvironment={props.onInstallEnvironment}
          onDelete={props.onDelete}
          onUpdateTool={props.onUpdateTool}
          onCancel={() => setPanelMode("overview")}
        />
      )}
      {addingServer && (
        <McpServerPanel
          mode="add"
          form={props.form}
          setForm={props.setForm}
          saving={props.saving}
          importText={importText}
          setImportText={setImportText}
          onImport={props.onImport}
          onSave={saveServer}
          onSaveAndTest={saveAndTestServer}
          onCheckEnvironment={props.onCheckEnvironment}
          onInstallEnvironment={props.onInstallEnvironment}
          onCancel={() => setPanelMode("overview")}
        />
      )}
    </section>
  );
}

function McpServerPanel(props: {
  readonly mode: "add" | "edit";
  readonly form: McpServerForm;
  readonly setForm: (form: McpServerForm) => void;
  readonly selectedServer?: McpCatalogServer;
  readonly saving?: boolean;
  readonly importText: string;
  readonly setImportText: (value: string) => void;
  readonly onImport: (config: string) => void;
  readonly onSave: (form?: McpServerForm) => Promise<void>;
  readonly onSaveAndTest: (form?: McpServerForm) => Promise<void>;
  readonly onCheckEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onInstallEnvironment: (form: Pick<McpServerForm, "command" | "commandLine">) => Promise<McpEnvironmentCheckResponse>;
  readonly onDelete?: (serverId: string) => void;
  readonly onUpdateTool?: (serverId: string, toolName: string, enabled: boolean, autoApproved?: boolean) => void;
  readonly onCancel: () => void;
}): React.ReactElement {
  const canSave = canSaveMcpServerForm(props.form);
  const canTest = canTestMcpServerForm(props.form);
  const editing = props.mode === "edit";
  const fieldPrefix = editing ? mcpFieldId("mcp-edit", props.form.serverId || "draft") : "mcp-add";
  const visibleTools = props.selectedServer?.tools ?? [];
  const exposedTools = props.selectedServer?.exposedTools ?? [];
  const hasSavedAuth = props.selectedServer?.authSecretRefCount !== undefined && props.selectedServer.authSecretRefCount > 0;
  const selectedError = mcpCompactError(props.selectedServer?.errorSummary ?? props.selectedServer?.lastError);
  const selectedStatus = props.selectedServer === undefined
    ? "未保存"
    : mcpRuntimeStatusLabel(props.selectedServer.runtimeStatus ?? props.selectedServer.availability);
  const selectedStatusTone = props.selectedServer === undefined
    ? "neutral"
    : mcpStatusTone(props.selectedServer.runtimeStatus ?? props.selectedServer.availability);
  const activeServer = props.selectedServer;
  const title = editing ? `编辑服务：${props.form.label || props.form.serverId}` : "连接工具";
  const [environmentCheck, setEnvironmentCheck] = React.useState<McpEnvironmentCheckResponse | undefined>();
  const [checkingEnvironment, setCheckingEnvironment] = React.useState(false);
  const [installingEnvironment, setInstallingEnvironment] = React.useState(false);
  React.useEffect(() => {
    setEnvironmentCheck(undefined);
  }, [props.form.transport, props.form.command, props.form.commandLine]);
  const runEnvironmentCheck = async (): Promise<void> => {
    if (props.form.transport !== "stdio" || checkingEnvironment || installingEnvironment) return;
    setCheckingEnvironment(true);
    try {
      const result = await props.onCheckEnvironment(props.form);
      setEnvironmentCheck(result);
    } catch {
      setEnvironmentCheck({
        ok: false,
        status: "check_failed",
        message: "环境检测未完成。",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setCheckingEnvironment(false);
    }
  };
  const runEnvironmentInstall = async (): Promise<void> => {
    if (props.form.transport !== "stdio" || checkingEnvironment || installingEnvironment) return;
    setInstallingEnvironment(true);
    setEnvironmentCheck((previous) => ({
      ok: false,
      status: "installing",
      command: previous?.command,
      installable: previous?.installable,
      message: "安装中。",
      checkedAt: new Date().toISOString(),
    }));
    try {
      const result = await props.onInstallEnvironment(props.form);
      setEnvironmentCheck(result);
    } catch {
      setEnvironmentCheck({
        ok: false,
        status: "install_failed",
        message: "安装失败。",
        checkedAt: new Date().toISOString(),
      });
    } finally {
      setInstallingEnvironment(false);
    }
  };
  return (
    <div className="mcp-subpanel-overlay" role="dialog" aria-modal="true" aria-label={editing ? "编辑服务" : "连接工具"}>
      <div className="mcp-subpanel-backdrop" aria-hidden="true" onClick={props.onCancel} />
      <section className={`mcp-subpanel ${editing ? "edit" : "add"}`}>
        <header className="mcp-subpanel-header">
          <div className="mcp-subpanel-title">
            <h4>{title}</h4>
            {editing && <span className={`mcp-status-pill ${selectedStatusTone}`}>{selectedStatus}</span>}
          </div>
          <button type="button" className="settings-close-button" aria-label="关闭" onClick={props.onCancel}>
            <X size={16} />
          </button>
        </header>
        <div className="mcp-subpanel-body">
          {editing && props.selectedServer !== undefined && (
            <div className="mcp-status-strip">
              <span>{mcpRuntimeStatusLabel(props.selectedServer.runtimeStatus ?? props.selectedServer.availability)}</span>
              <span>{transportLabel(props.selectedServer.transport)}</span>
              <span>{visibleTools.length} 个工具</span>
              {props.selectedServer.lastConnectedAt !== undefined && <span>最近连接：{props.selectedServer.lastConnectedAt}</span>}
              {selectedError !== undefined && (
                <span className="mcp-status-error">错误：{selectedError}</span>
              )}
            </div>
          )}
          <McpConnectionFields
            form={props.form}
            setForm={props.setForm}
            fieldPrefix={fieldPrefix}
            selectedServer={props.selectedServer}
            hasSavedAuth={hasSavedAuth}
            environmentCheck={environmentCheck}
            checkingEnvironment={checkingEnvironment}
            installingEnvironment={installingEnvironment}
            onCheckEnvironment={() => void runEnvironmentCheck()}
            onInstallEnvironment={() => void runEnvironmentInstall()}
          />
          {editing && (
            <section className="mcp-form-section">
              <details className="mcp-tool-authorization">
                <summary>
                  <span className="mcp-tool-authorization-copy">
                    <strong>工具授权</strong>
                  </span>
                  <span className="mcp-tool-authorization-actions">
                    <span className="mcp-tool-authorization-count">{exposedTools.length} / {visibleTools.length} 已启用</span>
                  </span>
                </summary>
                <div className="mcp-tool-list">
                  {activeServer === undefined || visibleTools.length === 0 ? (
                    <div className="capability-empty">保存并测试连接后选择工具</div>
                  ) : (
                    <div className="mcp-tool-auth-table">
                      <div className="mcp-tool-auth-header" aria-hidden="true">
                        <span>工具</span>
                        <span>启用</span>
                        <span>自动批准</span>
                      </div>
                      {visibleTools.map((tool) => {
                        const enabled = isMcpToolEnabled(activeServer, tool.name);
                        const autoApproved = isMcpToolAutoApproved(activeServer, tool.name);
                        return (
                          <McpToolAuthorizationRow
                            key={tool.name}
                            title={mcpToolDisplayTitle(activeServer, tool)}
                            enabled={enabled}
                            autoApproved={autoApproved}
                            onToggle={() => props.onUpdateTool?.(activeServer.serverId, tool.name, !enabled)}
                            onToggleAutoApproval={() => props.onUpdateTool?.(
                              activeServer.serverId,
                              tool.name,
                              enabled || !autoApproved,
                              !autoApproved
                            )}
                          />
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            </section>
          )}
          {!editing && (
            <details className="mcp-advanced">
              <summary><span className="mcp-advanced-summary-label">高级设置</span></summary>
              <McpAdvancedOptions
                form={props.form}
                setForm={props.setForm}
                fieldPrefix={fieldPrefix}
                importText={props.importText}
                setImportText={props.setImportText}
                saving={props.saving}
                onImport={props.onImport}
              />
            </details>
          )}
        </div>
        <footer className={`mcp-subpanel-footer ${editing ? "split" : ""}`}>
          {editing && props.selectedServer !== undefined && (
            <button
              type="button"
              className="page-action-button danger icon-only"
              aria-label="删除服务"
              onClick={() => props.onDelete?.(props.selectedServer?.serverId ?? "")}
              disabled={props.saving}
            >
              <Trash2 size={14} />
            </button>
          )}
          <div className="mcp-subpanel-footer-actions">
            <button type="button" className="page-action-button" onClick={props.onCancel} disabled={props.saving}>
              {editing ? "关闭" : "取消"}
            </button>
            <button type="button" className="page-action-button" onClick={() => void props.onSave(props.form)} disabled={props.saving || !canSave}>
              <Save size={14} />
              保存
            </button>
            <button type="button" className="page-action-button primary" onClick={() => void props.onSaveAndTest(props.form)} disabled={props.saving || !canTest}>
              {editing && <Link2 size={14} />}
              {props.saving ? "保存中" : editing ? "测试连接" : "保存并测试"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function McpConnectionFields(props: {
  readonly form: McpServerForm;
  readonly setForm: (form: McpServerForm) => void;
  readonly fieldPrefix: string;
  readonly selectedServer?: McpCatalogServer;
  readonly hasSavedAuth?: boolean;
  readonly environmentCheck?: McpEnvironmentCheckResponse;
  readonly checkingEnvironment?: boolean;
  readonly installingEnvironment?: boolean;
  readonly onCheckEnvironment: () => void;
  readonly onInstallEnvironment: () => void;
}): React.ReactElement {
  const authorizationHeaderPlaceholder = props.hasSavedAuth === true ? SAVED_API_KEY_MASK : "Bearer ...";
  const canCheckEnvironment = (props.form.commandLine.trim() || props.form.command.trim()).length > 0;
  const canInstallEnvironment =
    props.environmentCheck?.status === "not_found" &&
    props.environmentCheck.installable === true &&
    props.installingEnvironment !== true;
  return (
    <section className="mcp-form-section">
      <div className="mcp-form-grid mcp-identity-grid">
        <label htmlFor={`${props.fieldPrefix}-transport`}>
          类型
          <SettingsSelectControl
            id={`${props.fieldPrefix}-transport`}
            ariaLabel="类型"
            value={props.form.transport}
            options={[
              { value: "stdio", label: transportOptionLabel("stdio") },
              { value: "http", label: transportOptionLabel("http") },
              { value: "sse", label: transportOptionLabel("sse") },
            ]}
            onChange={(value) => props.setForm(formWithTransport(props.form, transportFromValue(value)))}
          />
        </label>
        <label htmlFor={`${props.fieldPrefix}-label`}>
          名称
          <input
            id={`${props.fieldPrefix}-label`}
            aria-label="名称"
            value={props.form.label}
            onChange={(event) => props.setForm({ ...props.form, label: event.target.value })}
            placeholder="我的工具服务"
          />
        </label>
      </div>
      <div className="mcp-form-grid mcp-transport-params-grid">
        {props.form.transport === "stdio" ? (
          <>
            <div className="mcp-connection-main mcp-command-field">
              <div className="mcp-field-title-row">
                <label htmlFor={`${props.fieldPrefix}-command`}>命令</label>
                <div className="mcp-field-actions">
                  {props.environmentCheck !== undefined && (
                    <McpEnvironmentCheckResult result={props.environmentCheck} />
                  )}
                  <button
                    type="button"
                    className="mcp-inline-action"
                    onClick={props.onCheckEnvironment}
                    disabled={props.checkingEnvironment === true || props.installingEnvironment === true || !canCheckEnvironment}
                  >
                    {props.checkingEnvironment === true ? "检测中" : "环境检测"}
                  </button>
                  {canInstallEnvironment && (
                    <button
                      type="button"
                      className="mcp-inline-action"
                      onClick={props.onInstallEnvironment}
                      disabled={!canCheckEnvironment}
                    >
                      安装
                    </button>
                  )}
                  {props.installingEnvironment === true && (
                    <button type="button" className="mcp-inline-action" disabled>
                      安装中
                    </button>
                  )}
                </div>
              </div>
              <input
                id={`${props.fieldPrefix}-command`}
                aria-label="命令"
                autoComplete="off"
                spellCheck={false}
                value={props.form.commandLine}
                onChange={(event) => props.setForm({ ...props.form, commandLine: event.target.value, command: "" })}
                placeholder={props.selectedServer?.commandSummary ?? "npx -y @modelcontextprotocol/server-filesystem ."}
              />
            </div>
            <label htmlFor={`${props.fieldPrefix}-args`}>
              参数
              <textarea
                id={`${props.fieldPrefix}-args`}
                aria-label="参数"
                value={props.form.args}
                onChange={(event) => props.setForm({ ...props.form, args: event.target.value })}
                placeholder="可选，每行一个参数"
              />
            </label>
            <label htmlFor={`${props.fieldPrefix}-env`}>
              环境变量
              <textarea
                id={`${props.fieldPrefix}-env`}
                aria-label="环境变量"
                value={props.form.envSecretRefs}
                onChange={(event) => props.setForm({ ...props.form, envSecretRefs: event.target.value })}
                placeholder="可选，每行一个变量名"
              />
            </label>
          </>
        ) : (
          <>
            <label className="mcp-connection-main" htmlFor={`${props.fieldPrefix}-url`}>
              URL
              <input
                id={`${props.fieldPrefix}-url`}
                aria-label="URL"
                autoComplete="off"
                spellCheck={false}
                value={props.form.url}
                onChange={(event) => props.setForm({ ...props.form, url: event.target.value })}
                placeholder={props.selectedServer?.url ?? "https://example.com/mcp"}
              />
            </label>
            <label className="mcp-network-token-field" htmlFor={`${props.fieldPrefix}-authorization`}>
              Authorization 请求头（可选）
              <input
                id={`${props.fieldPrefix}-authorization`}
                aria-label="Authorization 请求头"
                type="password"
                value={props.form.bearerTokenValue}
                onChange={(event) => {
                  const token = event.target.value;
                  props.setForm({
                    ...props.form,
                    authMode: token.trim().length > 0 || props.hasSavedAuth === true ? "bearer" : "none",
                    authTouched: token.trim().length > 0,
                    bearerTokenValue: token,
                    apiKeyValue: "",
                    customHeaderValue: "",
                  });
                }}
                placeholder={authorizationHeaderPlaceholder}
              />
            </label>
          </>
        )}
      </div>
    </section>
  );
}

function McpEnvironmentCheckResult(props: {
  readonly result: McpEnvironmentCheckResponse;
}): React.ReactElement {
  return (
    <div className={`mcp-environment-result ${mcpEnvironmentTone(props.result.status)}`} role="status">
      <span className="mcp-environment-dot" aria-hidden="true" />
      <span>{mcpEnvironmentStatusText(props.result)}</span>
    </div>
  );
}

function McpAdvancedOptions(props: {
  readonly form: McpServerForm;
  readonly setForm: (form: McpServerForm) => void;
  readonly fieldPrefix: string;
  readonly importText: string;
  readonly setImportText: (value: string) => void;
  readonly saving?: boolean;
  readonly onImport: (config: string) => void;
}): React.ReactElement {
  return (
    <div className="mcp-advanced-content">
      <div className="mcp-advanced-row">
        <label className="mcp-confirmation-field" htmlFor={`${props.fieldPrefix}-confirmation-mode`}>
          <span>确认策略</span>
          <SettingsSelectControl
            id={`${props.fieldPrefix}-confirmation-mode`}
            ariaLabel="确认策略"
            value={props.form.confirmationMode}
            options={[
              { value: "never", label: "不确认" },
              { value: "unsafe_only", label: "只确认声明需要确认的工具" },
              { value: "always", label: "每次确认" },
            ]}
            onChange={(value) => props.setForm({ ...props.form, confirmationMode: confirmationModeFromValue(value) })}
          />
        </label>
      </div>
      <div className="mcp-import-block">
        <div className="mcp-import-title-row">
          <label htmlFor={`${props.fieldPrefix}-import-json`}>导入 JSON</label>
          <button
            type="button"
            className="page-action-button"
            onClick={() => {
              props.onImport(props.importText);
              props.setImportText("");
            }}
            disabled={props.saving || props.importText.trim().length === 0}
          >
            导入配置
          </button>
        </div>
        <textarea
          id={`${props.fieldPrefix}-import-json`}
          aria-label="导入 JSON"
          value={props.importText}
          onChange={(event) => props.setImportText(event.target.value)}
          placeholder='{"mcpServers":{"context7":{"url":"https://mcp.context7.com/mcp"}}}'
        />
      </div>
    </div>
  );
}

function SettingsSelectControl(props: {
  readonly id: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly SettingsSelectOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const selectedIndex = Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const selectedOption = props.options[selectedIndex] ?? props.options[0];
  const listId = `${props.id}-listbox`;
  const updateSelection = (value: string): void => {
    props.onChange(value);
    setOpen(false);
  };
  const stepSelection = (direction: 1 | -1): void => {
    if (props.options.length === 0) return;
    const nextIndex = (selectedIndex + direction + props.options.length) % props.options.length;
    const nextOption = props.options[nextIndex];
    if (nextOption !== undefined) {
      props.onChange(nextOption.value);
      setOpen(true);
    }
  };
  return (
    <div
      className={`settings-select-control ${open ? "open" : ""}`}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget as Node | null;
        if (!event.currentTarget.contains(nextFocus)) {
          setOpen(false);
        }
      }}
    >
      <button
        id={props.id}
        type="button"
        className="settings-select-trigger"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            stepSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            stepSelection(-1);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{selectedOption?.label ?? props.value}</span>
        <span className="settings-select-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div id={listId} className="settings-select-popover" role="listbox" aria-label={props.ariaLabel}>
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="settings-select-option"
              role="option"
              aria-selected={option.value === props.value}
              data-selected={option.value === props.value}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateSelection(option.value);
              }}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                updateSelection(option.value);
              }}
              onClick={() => updateSelection(option.value)}
            >
              <span>{option.label}</span>
              <span className="settings-select-option-mark" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function McpToolAuthorizationRow(props: {
  readonly title: string;
  readonly enabled: boolean;
  readonly autoApproved: boolean;
  readonly onToggle: () => void;
  readonly onToggleAutoApproval: () => void;
}): React.ReactElement {
  return (
    <article className="mcp-tool-auth-row">
      <strong>{props.title}</strong>
      <button
        type="button"
        className="mcp-tool-auth-state"
        aria-pressed={props.enabled}
        aria-label={`${props.enabled ? "停用" : "启用"} ${props.title}`}
        onClick={props.onToggle}
      >
        <span aria-hidden="true" />
      </button>
      <button
        type="button"
        className="mcp-tool-auth-state"
        aria-pressed={props.autoApproved}
        aria-label={`${props.autoApproved ? "关闭自动批准" : "开启自动批准"} ${props.title}`}
        onClick={props.onToggleAutoApproval}
      >
        <span aria-hidden="true" />
      </button>
    </article>
  );
}

function formFromMcpCatalog(server: NonNullable<ToolsResponse["mcpCatalog"]>[number], previous: McpServerForm): McpServerForm {
  const authMode = server.authSecretRefCount !== undefined && server.authSecretRefCount > 0 && isNetworkMcpTransport(server.transport)
    ? "bearer"
    : "none";
  return {
    ...previous,
    serverId: server.serverId,
    label: server.label,
    transport: server.transport,
    authMode,
    authTouched: false,
    confirmationMode: server.confirmationMode ?? "never",
    toolExposureMode: server.toolExposureMode ?? "none",
    enabledTools: server.enabledTools ?? [],
    autoApprovedTools: server.autoApprovedTools ?? [],
    command: "",
    args: "",
    commandLine: server.commandSummary ?? "",
    url: server.url ?? "",
    envSecretRefs: "",
    headerSecretRefs: "",
    bearerTokenSecretRef: "",
    bearerTokenValue: "",
    apiKeySecretRef: "",
    apiKeyHeaderName: "X-API-Key",
    apiKeyValue: "",
    customHeaderName: "",
    customHeaderValue: "",
    enabled: server.enabled,
  };
}

function emptyMcpServerForm(): McpServerForm {
  return {
    serverId: "",
    label: "",
    transport: "stdio",
    authMode: "none",
    authTouched: false,
    confirmationMode: "never",
    toolExposureMode: "none",
    enabledTools: [],
    autoApprovedTools: [],
    command: "",
    args: "",
    commandLine: "",
    url: "",
    envSecretRefs: "",
    headerSecretRefs: "",
    bearerTokenSecretRef: "",
    bearerTokenValue: "",
    apiKeySecretRef: "",
    apiKeyHeaderName: "X-API-Key",
    apiKeyValue: "",
    customHeaderName: "",
    customHeaderValue: "",
    enabled: true,
  };
}

function canSaveMcpServerForm(form: McpServerForm): boolean {
  return effectiveMcpServerId(form).length > 0;
}

function canTestMcpServerForm(form: McpServerForm): boolean {
  if (!canSaveMcpServerForm(form)) return false;
  if (form.transport === "stdio") {
    return form.commandLine.trim().length > 0 || form.command.trim().length > 0;
  }
  return form.url.trim().length > 0;
}

function formWithDerivedServerId(form: McpServerForm): McpServerForm {
  const serverId = effectiveMcpServerId(form);
  return form.serverId.trim().length > 0 || serverId.length === 0
    ? form
    : { ...form, serverId };
}

function effectiveMcpServerId(form: McpServerForm): string {
  const explicit = form.serverId.trim();
  if (explicit.length > 0) return explicit;
  const fromLabel = normalizeMcpServerId(form.label);
  if (fromLabel.length > 0) return fromLabel;
  return suggestMcpServerId(form.transport === "stdio" ? form.commandLine : form.url, form.transport);
}

function suggestMcpServerId(value: string, transport: McpServerForm["transport"]): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (transport !== "stdio") {
    try {
      const url = new URL(trimmed);
      const pathName = url.pathname.split("/").filter(Boolean).pop();
      return normalizeMcpServerId(pathName ?? url.hostname);
    } catch {
      return normalizeMcpServerId(trimmed);
    }
  }
  const parts = trimmed.split(/\s+/u).filter(Boolean);
  const packageName = [...parts].reverse().find((part) => !part.startsWith("-") && part !== "." && part !== "npx" && part !== "pnpm" && part !== "bunx");
  return normalizeMcpServerId(packageName ?? trimmed);
}

function normalizeMcpServerId(value: string): string {
  const withoutScope = value.replace(/^@/u, "").replace(/\//gu, "-");
  return withoutScope.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function mcpToolDisplayTitle(
  server: NonNullable<ToolsResponse["mcpCatalog"]>[number],
  tool: NonNullable<ToolsResponse["mcpCatalog"]>[number]["tools"][number],
): string {
  const title = tool.displayName?.trim();
  if (title !== undefined && title.length > 0 && title !== "扩展工具") {
    return title;
  }
  const localName = tool.name.startsWith(`${server.serverId}__`) ? tool.name.slice(`${server.serverId}__`.length) : tool.name;
  return localName || tool.name;
}

function mcpStatusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  switch (status) {
    case "connected":
      return "success";
    case "error":
    case "unavailable":
      return "danger";
    case "connecting":
    case "configured":
      return "warning";
    default:
      return "neutral";
  }
}

function mcpServerCardFacts(server: NonNullable<ToolsResponse["mcpCatalog"]>[number]): readonly string[] {
  return [`${server.tools.length} 个工具`, mcpConfirmationModeLabel(server.confirmationMode)];
}

function mcpServerCardCommand(server: NonNullable<ToolsResponse["mcpCatalog"]>[number]): string {
  if (server.transport === "stdio") {
    return server.commandSummary ?? "本地命令";
  }
  return server.url ?? transportLabel(server.transport);
}

function mcpConfirmationModeLabel(mode?: "always" | "unsafe_only" | "never"): string {
  if (mode === "never") return "不确认";
  if (mode === "always") return "全部确认";
  return "按工具声明确认";
}

function isMcpToolEnabled(server: NonNullable<ToolsResponse["mcpCatalog"]>[number], toolName: string): boolean {
  if (server.toolExposureMode === "all") {
    return true;
  }
  if (server.toolExposureMode === "none") {
    return false;
  }
  const enabledTools = server.enabledTools ?? [];
  const localName = toolName.startsWith(`${server.serverId}__`) ? toolName.slice(`${server.serverId}__`.length) : toolName;
  return enabledTools.includes(toolName) || enabledTools.includes(localName);
}

function isMcpToolAutoApproved(server: NonNullable<ToolsResponse["mcpCatalog"]>[number], toolName: string): boolean {
  const autoApprovedTools = server.autoApprovedTools ?? [];
  const localName = toolName.startsWith(`${server.serverId}__`) ? toolName.slice(`${server.serverId}__`.length) : toolName;
  return autoApprovedTools.includes(toolName) || autoApprovedTools.includes(localName);
}

function transportLabel(transport: "stdio" | "http" | "sse"): string {
  if (transport === "http") return "HTTP";
  if (transport === "sse") return "SSE";
  return "本地命令";
}

function transportOptionLabel(transport: "stdio" | "http" | "sse"): string {
  if (transport === "http") return "HTTP";
  if (transport === "sse") return "SSE";
  return "本地命令";
}

function mcpFieldId(prefix: string, value: string): string {
  const safeValue = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return safeValue.length > 0 ? `${prefix}-${safeValue}` : prefix;
}

function transportFromValue(value: string): "stdio" | "http" | "sse" {
  return value === "http" || value === "sse" ? value : "stdio";
}

function formWithTransport(form: McpServerForm, transport: McpServerForm["transport"]): McpServerForm {
  if (transport === form.transport) {
    return form;
  }
  if (transport === "stdio") {
    return {
      ...form,
      transport,
      url: "",
      authMode: "none",
      authTouched: false,
      bearerTokenValue: "",
      apiKeyValue: "",
      customHeaderValue: "",
    };
  }
  const hasToken = form.bearerTokenValue.trim().length > 0;
  return {
    ...form,
    transport,
    command: "",
    commandLine: "",
    args: "",
    envSecretRefs: "",
    authMode: hasToken || form.authMode !== "none" ? "bearer" : "none",
    authTouched: hasToken,
    apiKeyValue: "",
    customHeaderValue: "",
  };
}

function isNetworkMcpTransport(transport: "stdio" | "http" | "sse"): boolean {
  return transport === "http" || transport === "sse";
}

function confirmationModeFromValue(value: string): "always" | "unsafe_only" | "never" {
  return value === "unsafe_only" || value === "never" ? value : "always";
}

function mcpRuntimeStatusLabel(status: string): string {
  switch (status) {
    case "connected":
      return "已连接";
    case "connecting":
      return "连接中";
    case "configured":
      return "已配置";
    case "disabled":
      return "已停用";
    case "error":
      return "连接失败";
    case "unavailable":
      return "缺少配置";
    default:
      return "已配置";
  }
}

function mcpCompactError(error?: string): string | undefined {
  const trimmed = error?.replace(/\s+/g, " ").trim();
  if (trimmed === undefined || trimmed.length === 0) return undefined;
  const parsedMessage = parseMcpErrorJsonMessage(trimmed);
  const compact = normalizeMcpErrorMessage(parsedMessage ?? trimmed);
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function mcpEnvironmentTone(status: McpEnvironmentCheckResponse["status"]): "success" | "warning" | "danger" {
  if (status === "ready" || status === "installed") return "success";
  if (status === "check_failed" || status === "install_failed") return "danger";
  return "warning";
}

function mcpEnvironmentStatusText(result: McpEnvironmentCheckResponse): string {
  switch (result.status) {
    case "ready":
      return "已就绪";
    case "installed":
      return "已安装";
    case "installing":
      return "安装中";
    case "missing_command":
      return "未填写命令";
    case "check_failed":
      return "检测失败";
    case "install_failed":
      return "安装失败";
    case "unsupported":
      return "不支持安装";
    default:
      return result.command === undefined || result.command.trim().length === 0
        ? "缺少运行文件"
        : `缺少运行文件：${result.command}`;
  }
}

function parseMcpErrorJsonMessage(error: string): string | undefined {
  const jsonStart = error.indexOf("{");
  if (jsonStart < 0) return undefined;
  try {
    const parsed = JSON.parse(error.slice(jsonStart)) as { readonly error?: { readonly message?: unknown } };
    return typeof parsed.error?.message === "string" ? parsed.error.message : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMcpErrorMessage(message: string): string {
  return message.replace(/^Internal error:\s*/i, "").trim();
}
