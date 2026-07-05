import React from "react";
import type { AppSettingsController } from "../app-settings-controller";
import type { AppState } from "../app-state";
import type { ModelProviderModelCatalog } from "../contracts/config";
import { SettingsDialog } from "./settings-dialog";
import type { McpServerForm, ModelForm, SettingsGroup, ToolForm } from "./settings-types";

type WorkbenchSettingsDialogFormState = {
  readonly modelForm: ModelForm;
  readonly setModelForm: (form: ModelForm) => void;
  readonly workspaceDirectory: string;
  readonly setWorkspaceDirectory: (value: string) => void;
  readonly desktopAgentSystemPrompt: string;
  readonly setDesktopAgentSystemPrompt: (value: string) => void;
  readonly toolForm: ToolForm;
  readonly setToolForm: (form: ToolForm) => void;
  readonly mcpServerForm: McpServerForm;
  readonly setMcpServerForm: (form: McpServerForm) => void;
};

type WorkbenchSettingsDialogPreferences = {
  readonly modelUsageDisplayEnabled: boolean;
  readonly onModelUsageDisplayChange: (enabled: boolean) => void;
  readonly agentClusterEnabled: boolean;
  readonly onAgentClusterEnabledChange: (enabled: boolean) => void;
};

type WorkbenchSettingsDialogSavingState = {
  readonly model?: boolean;
  readonly workspace?: boolean;
  readonly desktopAgent?: boolean;
  readonly tools?: boolean;
};

type WorkbenchSettingsDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialGroup?: SettingsGroup;
  readonly app: Pick<AppState, "config" | "tools" | "appUpdate" | "skills" | "subAgents">;
  readonly modelCatalogs?: Readonly<Record<string, ModelProviderModelCatalog>>;
  readonly forms: WorkbenchSettingsDialogFormState;
  readonly preferences: WorkbenchSettingsDialogPreferences;
  readonly saving: WorkbenchSettingsDialogSavingState;
  readonly actions: AppSettingsController;
};

export function WorkbenchSettingsDialog(props: WorkbenchSettingsDialogProps): React.ReactElement | null {
  return (
    <SettingsDialog
      open={props.open}
      onClose={props.onClose}
      initialGroup={props.initialGroup}
      config={props.app.config}
      appUpdate={props.app.appUpdate}
      modelForm={props.forms.modelForm}
      setModelForm={props.forms.setModelForm}
      workspaceDirectory={props.forms.workspaceDirectory}
      setWorkspaceDirectory={props.forms.setWorkspaceDirectory}
      desktopAgentSystemPrompt={props.forms.desktopAgentSystemPrompt}
      setDesktopAgentSystemPrompt={props.forms.setDesktopAgentSystemPrompt}
      modelUsageDisplayEnabled={props.preferences.modelUsageDisplayEnabled}
      onModelUsageDisplayChange={props.preferences.onModelUsageDisplayChange}
      agentClusterEnabled={props.preferences.agentClusterEnabled}
      onAgentClusterEnabledChange={props.preferences.onAgentClusterEnabledChange}
      onSaveCommandShell={props.actions.saveCommandShell}
      savingModel={props.saving.model}
      savingWorkspace={props.saving.workspace}
      savingDesktopAgent={props.saving.desktopAgent}
      onSaveModel={props.actions.saveModelConfig}
      onCreateCustomProfile={props.actions.createCustomModelProfile}
      onReorderModelProviders={props.actions.reorderModelProviders}
      onDeleteModelProvider={props.actions.deleteModelProvider}
      onFetchModels={props.actions.fetchModelsForProfile}
      onSaveModelCatalog={props.actions.saveModelCatalog}
      onSaveModelCapabilities={props.actions.saveModelCapabilities}
      onRevealModelApiKey={props.actions.revealModelApiKey}
      modelCatalogs={props.modelCatalogs}
      skills={props.app.skills}
      subAgents={props.app.subAgents}
      onSaveWorkspace={(nextWorkspaceDirectory) => void props.actions.saveWorkspace(nextWorkspaceDirectory)}
      onSelectWorkspaceDirectory={() => void props.actions.selectWorkspace()}
      onSaveDesktopAgentSystemPrompt={props.actions.saveDesktopAgentSystemPrompt}
      onResetDesktopAgentSystemPrompt={props.actions.resetDesktopAgentSystemPrompt}
      tools={props.app.tools}
      toolForm={props.forms.toolForm}
      setToolForm={props.forms.setToolForm}
      mcpServerForm={props.forms.mcpServerForm}
      setMcpServerForm={props.forms.setMcpServerForm}
      savingTools={props.saving.tools}
      onSaveTools={(nextToolForm) => void props.actions.saveTools(nextToolForm)}
      onSaveSkillTriggerMode={(mode) => void props.actions.saveSkillTriggerMode(mode)}
      onSaveMcpServer={props.actions.saveMcpServer}
      onLoadMcpReferences={props.actions.loadMcpReferences}
      onImportMcpConfig={(config) => void props.actions.importMcpConfig(config)}
      onTestMcpServer={(serverId) => void props.actions.testMcpServer(serverId)}
      onCheckMcpEnvironment={props.actions.checkMcpEnvironment}
      onInstallMcpEnvironment={props.actions.installMcpEnvironment}
      onDeleteMcpServer={(serverId) => void props.actions.deleteMcpServer(serverId)}
      onUpdateMcpTool={(serverId, toolName, enabled, autoApproved) =>
        void props.actions.updateMcpTool(serverId, toolName, enabled, autoApproved)}
      onCheckAppUpdate={() => void props.actions.checkAppUpdate()}
      onInstallAppUpdate={() => void props.actions.installAppUpdate()}
      onRefreshSkills={() => void props.actions.refreshSkills()}
      onRefreshSubAgents={() => void props.actions.refreshSubAgents()}
      onUpdateSkill={(skill, enabled) => void props.actions.updateSkill(skill, enabled)}
    />
  );
}
