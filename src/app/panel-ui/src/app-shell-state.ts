import { useState, type Dispatch, type SetStateAction } from "react";
import {
  getModelUsageDisplayEnabled,
  saveModelUsageDisplayEnabled,
} from "./app-model-usage-display";
import { type SettingsGroup } from "./components/settings-types";
import type { Screen } from "./app-screen";
import type { AgentMode } from "./app-config-projection";
import { readLocalPreference, writeLocalPreference } from "./app-local-preferences";
import { isMultiAgentEntryEnabled } from "./app-multi-agent-availability";

export type AppShellStateOptions = {
  readonly agentMode: AgentMode;
  readonly onExitDeepMode: () => void;
};

export type AppShellState = {
  readonly screen: Screen;
  readonly setScreen: Dispatch<SetStateAction<Screen>>;
  readonly settingsOpen: boolean;
  readonly setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  readonly settingsGroup: SettingsGroup;
  readonly sidebarCollapsed: boolean;
  readonly setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  readonly modelUsageDisplayEnabled: boolean;
  readonly setModelUsageDisplayEnabled: Dispatch<SetStateAction<boolean>>;
  readonly agentClusterEnabled: boolean;
  readonly pinningConversationIds: ReadonlySet<string>;
  readonly setPinningConversationIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly inputCloseSignal: number;
  readonly setInputCloseSignal: Dispatch<SetStateAction<number>>;
  readonly openSettings: (group?: SettingsGroup) => void;
  readonly closeSettings: () => void;
  readonly changeModelUsageDisplay: (enabled: boolean) => void;
  readonly changeAgentClusterEnabled: (enabled: boolean) => void;
};

export function useAppShellState(options: AppShellStateOptions): AppShellState {
  const [screen, setScreen] = useState<Screen>("chat-empty");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup>("models");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsedPreference);
  const [modelUsageDisplayEnabled, setModelUsageDisplayEnabled] = useState(getModelUsageDisplayEnabled);
  const [agentClusterEnabled, setAgentClusterEnabled] = useState(() =>
    isMultiAgentEntryEnabled(loadAgentClusterEnabledPreference())
  );
  const [pinningConversationIds, setPinningConversationIds] = useState<ReadonlySet<string>>(() => new Set());
  const [inputCloseSignal, setInputCloseSignal] = useState(0);

  function openSettings(group: SettingsGroup = "models"): void {
    setInputCloseSignal((value) => value + 1);
    setSettingsGroup(group);
    setSettingsOpen(true);
  }

  function closeSettings(): void {
    setSettingsOpen(false);
  }

  function changeModelUsageDisplay(enabled: boolean): void {
    setModelUsageDisplayEnabled(enabled);
    saveModelUsageDisplayEnabled(enabled);
  }

  function changeAgentClusterEnabled(enabled: boolean): void {
    const nextEnabled = isMultiAgentEntryEnabled(enabled);
    setAgentClusterEnabled(nextEnabled);
    persistAgentClusterEnabledPreference(enabled);
    if (!nextEnabled && options.agentMode === "deep") {
      options.onExitDeepMode();
    }
  }

  return {
    screen,
    setScreen,
    settingsOpen,
    setSettingsOpen,
    settingsGroup,
    sidebarCollapsed,
    setSidebarCollapsed,
    modelUsageDisplayEnabled,
    setModelUsageDisplayEnabled,
    agentClusterEnabled,
    pinningConversationIds,
    setPinningConversationIds,
    inputCloseSignal,
    setInputCloseSignal,
    openSettings,
    closeSettings,
    changeModelUsageDisplay,
    changeAgentClusterEnabled,
  };
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "agentarbor.panel.sidebar.collapsed";
const AGENT_CLUSTER_ENABLED_STORAGE_KEY = "agentarbor.panel.agent_cluster.enabled";

function loadSidebarCollapsedPreference(): boolean {
  return readLocalPreference(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

function loadAgentClusterEnabledPreference(): boolean {
  return readLocalPreference(AGENT_CLUSTER_ENABLED_STORAGE_KEY) === "true";
}

function persistAgentClusterEnabledPreference(enabled: boolean): void {
  writeLocalPreference(AGENT_CLUSTER_ENABLED_STORAGE_KEY, enabled ? "true" : "false");
}

export function persistSidebarCollapsedPreference(collapsed: boolean): void {
  writeLocalPreference(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
}
