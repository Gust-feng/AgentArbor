export const AGENTARBOR_APP_NAME = "AgentArbor";
export const AGENTARBOR_APP_ID = "com.agentarbor.desktop";
export const AGENTARBOR_DEV_APP_ID = "com.agentarbor.desktop.dev";

export function desktopAppUserModelId(isPackaged: boolean): string {
  return isPackaged ? AGENTARBOR_APP_ID : AGENTARBOR_DEV_APP_ID;
}
