export type { ModelForm } from "./model-settings";

export type ToolForm = {
  readonly provider: string;
  readonly tavilyApiKey: string;
  readonly maxResults: string;
};

export type SettingsGroup = "models" | "capabilities" | "workspace" | "confirmation";
