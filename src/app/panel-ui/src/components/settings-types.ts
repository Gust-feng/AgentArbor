export type { ModelForm } from "./model-settings";

export type ToolForm = {
  readonly provider: string;
  readonly tavilyApiKey: string;
  readonly maxResults: string;
};

export type McpServerForm = {
  readonly serverId: string;
  readonly label: string;
  readonly transport: "stdio" | "http";
  readonly command: string;
  readonly args: string;
  readonly url: string;
  readonly envSecretRefs: string;
  readonly enabled: boolean;
};

export type SettingsGroup = "models" | "capabilities" | "workspace" | "confirmation";
