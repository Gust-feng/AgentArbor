import React, { useEffect, useState } from "react";
import { Maximize2, Minimize2, Minus, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { StartupIntroVisiblePhase } from "../app-startup-intro";
import { StartupIntroOverlay } from "../app-startup-intro";
import { appUpdateReadyText } from "../app-workbench-shell-props";
import type { AppUpdateInfo } from "../contracts/app-update";
import { Sidebar } from "./sidebar";
import { WorkbenchMain } from "./workbench-main";
import { WorkbenchSettingsDialog } from "./workbench-settings-dialog";

export function WorkbenchShell(props: {
  readonly startupIntroPhase: StartupIntroVisiblePhase | undefined;
  readonly sidebarCollapsed: boolean;
  readonly rootStyle?: React.CSSProperties;
  readonly sidebarProps: React.ComponentProps<typeof Sidebar>;
  readonly onToggleSidebar: () => void;
  readonly appUpdate?: AppUpdateInfo;
  readonly onInstallAppUpdate: () => void;
  readonly mainProps: React.ComponentProps<typeof WorkbenchMain>;
  readonly settingsDialogProps?: React.ComponentProps<typeof WorkbenchSettingsDialog>;
  readonly startupIntroOverlayProps?: React.ComponentProps<typeof StartupIntroOverlay>;
}): React.ReactElement {
  return (
    <div
      className="app-root"
      data-startup-intro={props.startupIntroPhase}
      data-sidebar-collapsed={props.sidebarCollapsed ? "true" : "false"}
      style={props.rootStyle}
    >
      <Sidebar {...props.sidebarProps} />

      <div className="app-workbench">
        <WorkbenchHeader
          collapsed={props.sidebarCollapsed}
          onToggleSidebar={props.onToggleSidebar}
        />
        {props.appUpdate?.status === "downloaded" && (
          <div className="app-update-ready-banner" role="status">
            <span>{appUpdateReadyText(props.appUpdate)}</span>
            <button type="button" onClick={props.onInstallAppUpdate}>
              重启安装
            </button>
          </div>
        )}
        <main className="app-main">
          <WorkbenchMain {...props.mainProps} />
        </main>
      </div>

      {props.settingsDialogProps !== undefined && <WorkbenchSettingsDialog {...props.settingsDialogProps} />}
      {props.startupIntroOverlayProps !== undefined && <StartupIntroOverlay {...props.startupIntroOverlayProps} />}
    </div>
  );
}

function WorkbenchHeader(props: {
  readonly collapsed: boolean;
  readonly onToggleSidebar: () => void;
}): React.ReactElement {
  const toggleLabel = props.collapsed ? "展开侧栏" : "收起侧栏";
  const hasDesktopWindowControls = typeof window !== "undefined" && window.agentarborDesktop !== undefined;

  return (
    <header className="app-workbench-header">
      <div className="app-workbench-header-inner">
        <div className="app-workbench-header-main">
          <button
            type="button"
            className="app-workbench-sidebar-toggle"
            aria-label={toggleLabel}
            onClick={props.onToggleSidebar}
          >
            {props.collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        {hasDesktopWindowControls && <DesktopWindowControls />}
      </div>
    </header>
  );
}

function DesktopWindowControls(): React.ReactElement {
  const [windowState, setWindowState] = useState<DesktopWindowState>({
    maximized: false,
    animating: false,
  });

  useEffect(() => {
    const desktop = window.agentarborDesktop;
    if (desktop === undefined) return;
    let mounted = true;
    void desktop.getWindowState().then((nextState) => {
      if (mounted) {
        setWindowState(nextState);
      }
    }).catch(() => undefined);
    const unsubscribe = desktop.onWindowStateChanged((nextState) => {
      setWindowState(nextState);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const maximizeLabel = windowState.maximized ? "还原窗口" : "最大化窗口";
  const MaximizeIcon = windowState.maximized ? Minimize2 : Maximize2;

  return (
    <div className="app-window-controls" aria-label="窗口控制">
      <button
        type="button"
        className="app-window-control"
        aria-label="最小化窗口"
        onClick={() => window.agentarborDesktop?.minimizeWindow()}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="app-window-control"
        aria-label={maximizeLabel}
        aria-pressed={windowState.maximized}
        data-window-state={windowState.maximized ? "maximized" : "normal"}
        data-window-animating={windowState.animating ? "true" : "false"}
        onClick={() => window.agentarborDesktop?.toggleMaximizeWindow()}
      >
        <MaximizeIcon size={14} />
      </button>
      <button
        type="button"
        className="app-window-control app-window-control-close"
        aria-label="关闭窗口"
        onClick={() => window.agentarborDesktop?.closeWindow()}
      >
        <X size={15} />
      </button>
    </div>
  );
}

type DesktopWindowState = {
  readonly maximized: boolean;
  readonly animating: boolean;
};
