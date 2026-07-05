import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getStartupAnimationEnabled, subscribeMotionSettingsChanged } from "./app-motion";
import {
  getModelUsageDisplayEnabled,
  subscribeModelUsageDisplayChanged,
} from "./app-model-usage-display";
import type { AppUpdateInfo } from "./contracts/app-update";

export type AppShellEffectsOptions = {
  readonly sidebarCollapsed: boolean;
  readonly persistSidebarCollapsed: (collapsed: boolean) => void;
  readonly setStartupAnimationEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setModelUsageDisplayEnabled: Dispatch<SetStateAction<boolean>>;
  readonly appUpdate?: AppUpdateInfo;
  readonly checkAppUpdate: () => Promise<void>;
  readonly refreshAppUpdateStatus: () => Promise<void>;
};

export function useAppShellEffects(options: AppShellEffectsOptions): void {
  const checkAppUpdateRef = useRef(options.checkAppUpdate);
  const refreshAppUpdateStatusRef = useRef(options.refreshAppUpdateStatus);
  const autoAppUpdateCheckRequestedRef = useRef(false);
  checkAppUpdateRef.current = options.checkAppUpdate;
  refreshAppUpdateStatusRef.current = options.refreshAppUpdateStatus;

  useEffect(() => {
    options.persistSidebarCollapsed(options.sidebarCollapsed);
  }, [options.persistSidebarCollapsed, options.sidebarCollapsed]);

  useEffect(() => subscribeMotionSettingsChanged(() => {
    options.setStartupAnimationEnabled(getStartupAnimationEnabled());
  }), [options.setStartupAnimationEnabled]);

  useEffect(() => subscribeModelUsageDisplayChanged(() => {
    options.setModelUsageDisplayEnabled(getModelUsageDisplayEnabled());
  }), [options.setModelUsageDisplayEnabled]);

  useEffect(() => {
    const update = options.appUpdate;
    if (
      autoAppUpdateCheckRequestedRef.current ||
      update === undefined ||
      update.status !== "idle" ||
      update.canCheck !== true
    ) {
      return;
    }
    autoAppUpdateCheckRequestedRef.current = true;
    void checkAppUpdateRef.current();
  }, [options.appUpdate?.canCheck, options.appUpdate?.status]);

  useEffect(() => {
    const status = options.appUpdate?.status;
    if (status !== "checking" && status !== "available" && status !== "downloading" && status !== "installing") {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshAppUpdateStatusRef.current();
    }, 1200);
    return () => window.clearInterval(timer);
  }, [options.appUpdate?.status]);
}
