import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { AboutSettings, SettingsDialog } from "./settings-dialog";

test("about settings controls developer-only product information", () => {
  function ControlledAbout(): React.ReactElement {
    const [enabled, setEnabled] = useState(false);
    return (
      <AboutSettings
        config={{
          product: {
            name: "AgentArbor",
            version: "0.3.2",
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

  const developerSwitch = screen.getByRole("switch", { name: "显示开发者信息" });
  expect(developerSwitch.getAttribute("aria-checked")).toBe("false");
  expect(screen.queryByLabelText("产品运行信息")).toBeNull();
  expect(screen.queryByLabelText("本机数据目录")).toBeNull();

  fireEvent.click(developerSwitch);

  expect(developerSwitch.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByLabelText("产品运行信息")).toBeTruthy();
  expect(screen.getByLabelText("本机数据目录")).toBeTruthy();
});

test("system prompt editor is only mounted in developer mode", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ message: "not available in this test" }),
    { status: 503, headers: { "content-type": "application/json" } },
  )));
  const hidden = renderSettingsDialog(false);

  expect(await screen.findByRole("heading", { name: "关于" })).toBeTruthy();
  expect(screen.queryByLabelText("Desktop Agent")).toBeNull();
  expect(screen.queryByRole("button", { name: "开发者选项" })).toBeNull();

  hidden.unmount();
  renderSettingsDialog(true);

  const promptEditor = await screen.findByLabelText("Desktop Agent");
  expect(promptEditor).toBeTruthy();
  expect((promptEditor as HTMLTextAreaElement).value).toBe("You are the configured agent.");
});

function renderSettingsDialog(developerModeEnabled: boolean): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog {...settingsDialogProps(developerModeEnabled)} />
    </QueryClientProvider>,
  );
}

function settingsDialogProps(developerModeEnabled: boolean): React.ComponentProps<typeof SettingsDialog> {
  return {
    open: true,
    onClose: () => undefined,
    initialGroup: "developer",
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
    workspaceDirectory: "",
    setWorkspaceDirectory: () => undefined,
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
    onSaveWorkspace: () => undefined,
    onSelectWorkspaceDirectory: () => undefined,
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
