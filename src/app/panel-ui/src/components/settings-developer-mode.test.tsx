import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AboutSettings, SettingsDialog } from "./settings-dialog";

test("about settings hides developer mode behind the version gesture", () => {
  function ControlledAbout(): React.ReactElement {
    const [enabled, setEnabled] = useState(false);
    return (
      <AboutSettings
        config={{
          product: {
            name: "AgentArbor",
            version: "0.4.0",
            defaultEntry: "Desktop Shell / Panel",
            runtimeModeLabel: "Ordinary Agent",
            configDirectory: "C:/config",
            runtimeDirectory: "C:/runtime",
          },
        }}
        agentClusterEnabled={false}
        onAgentClusterEnabledChange={() => undefined}
        developerModeEnabled={enabled}
        onDeveloperModeChange={setEnabled}
        onCheckAppUpdate={() => undefined}
        onInstallAppUpdate={() => undefined}
      />
    );
  }

  render(<ControlledAbout />);

  expect(screen.queryByRole("switch", { name: "显示开发者信息" })).toBeNull();
  expect(screen.queryByLabelText("产品运行信息")).toBeNull();
  expect(screen.queryByLabelText("本机数据目录")).toBeNull();

  const version = screen.getByRole("button", { name: "版本 0.4.0" });
  for (let click = 0; click < 7; click += 1) fireEvent.click(version);

  expect(screen.getByLabelText("产品运行信息")).toBeTruthy();
  expect(screen.getByLabelText("本机数据目录")).toBeTruthy();

  for (let click = 0; click < 7; click += 1) fireEvent.click(version);
  expect(screen.queryByLabelText("产品运行信息")).toBeNull();
  expect(screen.queryByLabelText("本机数据目录")).toBeNull();
});

test("system prompt editor is only mounted in developer mode", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ message: "not available in this test" }),
    { status: 503, headers: { "content-type": "application/json" } },
  )));
  const hidden = renderSettingsDialog(false, "basicCapabilities");

  expect(await screen.findByRole("heading", { name: "基础能力" })).toBeTruthy();
  expect(screen.queryByLabelText("Desktop Agent")).toBeNull();
  expect(screen.queryByRole("button", { name: "开发者选项" })).toBeNull();

  hidden.unmount();
  renderSettingsDialog(true, "developer");

  const promptEditor = await screen.findByLabelText("Desktop Agent");
  expect(promptEditor).toBeTruthy();
  expect((promptEditor as HTMLTextAreaElement).value).toBe("You are the configured agent.");
});

test("disabling developer mode removes the prompt editor from an open settings dialog", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  function ControlledSettings(): React.ReactElement {
    const [enabled, setEnabled] = useState(true);
    return (
      <>
        <QueryClientProvider client={queryClient}>
          <SettingsDialog
            {...settingsDialogProps(enabled, "developer")}
            onDeveloperModeChange={setEnabled}
          />
        </QueryClientProvider>
        <button type="button" onClick={() => setEnabled(false)}>关闭开发者模式</button>
      </>
    );
  }

  render(<ControlledSettings />);

  expect(await screen.findByLabelText("Desktop Agent")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "关闭开发者模式" }));
  expect(await screen.findByRole("heading", { name: "关于" })).toBeTruthy();
  expect(screen.queryByLabelText("Desktop Agent")).toBeNull();
});

test("about settings renders release notes for a newer version instead of exposing raw HTML", () => {
  render(
    <AboutSettings
      config={{ product: { name: "AgentArbor", version: "0.4.0" } }}
      appUpdate={{
        ok: true,
        status: "available",
        runtime: "manifest",
        currentVersion: "0.4.0",
        manifestUrlConfigured: true,
        canCheck: true,
        canInstall: false,
        latest: {
          version: "0.5.0",
          notes: "<h1>AgentArbor v0.5.0</h1><p>本版本包含更新。</p><h2>主要更新</h2><ul><li>渲染更新说明</li></ul>",
        },
      }}
      agentClusterEnabled={false}
      onAgentClusterEnabledChange={() => undefined}
      developerModeEnabled={false}
      onDeveloperModeChange={() => undefined}
      onCheckAppUpdate={() => undefined}
      onInstallAppUpdate={() => undefined}
    />,
  );

  expect(screen.getByLabelText("更新说明")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "AgentArbor v0.5.0" })).toBeTruthy();
  expect(screen.getByText("本版本包含更新。")).toBeTruthy();
  expect(screen.getByText("渲染更新说明")).toBeTruthy();
  expect(screen.queryByText("<h1>AgentArbor v0.5.0</h1>")).toBeNull();
});

test("about settings hides release notes when the current version is latest", () => {
  render(
    <AboutSettings
      config={{ product: { name: "AgentArbor", version: "0.4.0" } }}
      appUpdate={{
        ok: true,
        status: "up_to_date",
        runtime: "manifest",
        currentVersion: "0.4.0",
        manifestUrlConfigured: true,
        canCheck: true,
        canInstall: false,
        latest: {
          version: "0.4.0",
          notes: "旧状态中残留的更新说明也不应显示。",
        },
      }}
      agentClusterEnabled={false}
      onAgentClusterEnabledChange={() => undefined}
      developerModeEnabled={false}
      onDeveloperModeChange={() => undefined}
      onCheckAppUpdate={() => undefined}
      onInstallAppUpdate={() => undefined}
    />,
  );

  expect(screen.getByText("当前版本已是最新。")).toBeTruthy();
  expect(screen.queryByLabelText("更新说明")).toBeNull();
  expect(screen.queryByText("旧状态中残留的更新说明也不应显示。")).toBeNull();
});

function renderSettingsDialog(
  developerModeEnabled: boolean,
  initialGroup: React.ComponentProps<typeof SettingsDialog>["initialGroup"] = "developer",
): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog {...settingsDialogProps(developerModeEnabled, initialGroup)} />
    </QueryClientProvider>,
  );
}

function settingsDialogProps(
  developerModeEnabled: boolean,
  initialGroup: React.ComponentProps<typeof SettingsDialog>["initialGroup"],
): React.ComponentProps<typeof SettingsDialog> {
  return {
    open: true,
    onClose: () => undefined,
    initialGroup,
    config: {
      desktopAgent: {
        systemPrompt: "You are the configured agent.",
        isDefault: false,
        maxSystemPromptChars: 20_000,
      },
    },
    modelForm: {
      profileId: "",
      label: "",
      logoDataUrl: "",
      logoCleared: false,
      baseUrl: "",
      protocolKind: "openai_responses",
      model: "",
      apiKey: "",
      apiKeyCleared: false,
    },
    setModelForm: () => undefined,
    desktopAgentSystemPrompt: "You are the configured agent.",
    setDesktopAgentSystemPrompt: () => undefined,
    modelUsageDisplayEnabled: false,
    onModelUsageDisplayChange: () => undefined,
    agentClusterEnabled: false,
    onAgentClusterEnabledChange: () => undefined,
    developerModeEnabled,
    onDeveloperModeChange: () => undefined,
    onSaveCommandShell: () => undefined,
    onSaveModel: async () => undefined,
    onCreateCustomProfile: async () => undefined,
    onReorderModelProviders: async () => undefined,
    onDeleteModelProvider: async () => undefined,
    onFetchModels: async () => undefined,
    onSaveModelCatalog: async () => undefined,
    onSaveModelCapabilities: async () => undefined,
    onRevealModelApiKey: async () => undefined,
    skills: [],
    subAgents: [],
    onSaveDesktopAgentSystemPrompt: async () => undefined,
    onResetDesktopAgentSystemPrompt: async () => undefined,
    toolForm: {
      provider: "",
      apiKey: "",
      maxResults: "",
      googleEngineId: "",
    },
    setToolForm: () => undefined,
    mcpServerForm: {
      serverId: "",
      label: "",
      description: "",
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
    },
    setMcpServerForm: () => undefined,
    onSaveTools: () => undefined,
    onSaveSkillTriggerMode: () => undefined,
    onSaveMcpServer: async () => undefined,
    onLoadMcpReferences: async () => { throw new Error("not used"); },
    onImportMcpConfig: () => undefined,
    onTestMcpServer: () => undefined,
    onCheckMcpEnvironment: async () => { throw new Error("not used"); },
    onInstallMcpEnvironment: async () => { throw new Error("not used"); },
    onDeleteMcpServer: () => undefined,
    onUpdateMcpTool: () => undefined,
    onCheckAppUpdate: () => undefined,
    onInstallAppUpdate: () => undefined,
    onRefreshSkills: () => undefined,
    onRefreshSubAgents: () => undefined,
    onUpdateSkill: () => undefined,
  };
}
