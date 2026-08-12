import { useEffect, useMemo, useRef, useState } from "react";
import type { CurrentRunProjection } from "../../app-run-projection";
import type { TaskStatus } from "../../contracts/common";
import type { ChatInputProps } from "../../contracts/composer";
import type { Conversation } from "../../contracts/conversation";
import type { PendingConfirmation } from "../../contracts/run";
import type { View } from "./app/components/Sidebar";

export type WorkbenchNavigationInput = {
  readonly currentRun: Pick<CurrentRunProjection, "run">;
  readonly pendingConfirmation?: PendingConfirmation | NonNullable<CurrentRunProjection["workView"]>["pendingConfirmation"];
  readonly conversation?: Conversation;
  readonly inputProps: ChatInputProps;
  readonly onStartNewConversation: () => Promise<boolean>;
};

export type WorkbenchNavigation = {
  readonly view: View;
  readonly brainSelectedId: string | null;
  readonly spaceTargetId: string | null;
  readonly activeSpaceId: string | null;
  readonly homeFocusRequest: number;
  readonly homeInput: ChatInputProps;
  readonly conversationInput: ChatInputProps;
  readonly navigate: (target: View) => void;
  readonly onBrainSelect: (id: string | null) => void;
  readonly onActiveSpaceChange: (spaceId: string | null) => void;
  readonly onOpenInSpace: (spaceId: string, id: string) => void;
};

/**
 * Owns only workbench navigation and selection. Runtime state remains owned by
 * the existing workbench controllers and is passed in as a narrow input.
 *
 * Navigation semantics: the initial view may restore an active conversation
 * when there is no user intent yet, but an explicit navigation (Home, Brain,
 * Search, Space) is never hijacked by a running run or a pending confirmation.
 * Those states surface as global status hints instead of forced redirects.
 */
/**
 * 导航 hook 退役说明（2026-08）：
 * 本 hook 已不被任何组件装配，实际导航逻辑内联在 agentarbor-workbench.tsx。
 * 此处保留为导航语义的事实参考，并随当前口径更新：
 * 全屏对话视图（conv-active / conv-done）已退役，所有会话统一进入空间右侧对话面板，
 * 因此 initialView 不再直入 conv-active，运行中/待确认会话的恢复由组合根路由到所属空间。
 */
export function useWorkbenchNavigation(input: WorkbenchNavigationInput): WorkbenchNavigation {
  const [view, setView] = useState<View>(() => initialView(input));
  const [previousView, setPreviousView] = useState<View>("home");
  const [brainSelectedId, setBrainSelectedId] = useState<string | null>(null);
  const [spaceTargetId, setSpaceTargetId] = useState<string | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [homeFocusRequest, setHomeFocusRequest] = useState(0);
  const observedViewRef = useRef(view);
  const navigationIntentRef = useRef(view);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPreviousView(view);
        setView("search");
      }
      if (event.key === "Escape" && view === "search") setView(previousView);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previousView, view]);

  const navigate = (target: View): void => {
    navigationIntentRef.current = target;
    if (target === "search") setPreviousView(view);
    // Only search navigation sets a target explicitly. Normal navigation must
    // clear it, otherwise a later Space switch can reuse an id from another Space.
    setSpaceTargetId(null);
    if (target !== "brain") setBrainSelectedId(null);
    setView(target);
  };

  const homeInput = useMemo<ChatInputProps>(() => ({
    ...input.inputProps,
    autoFocus: true,
    placeholder: "想从哪里开始？",
    onSubmit: () => {
      if (input.inputProps.value.trim().length === 0) return;
      void input.onStartNewConversation().then((started) => {
        if (navigationIntentRef.current !== "home") return;
        if (started) {
          // 全屏对话视图已退役（死代码保留）：真实实现由组合根 surfaceConversation
          // 把新会话路由到空间右侧对话面板，这里不再进入 conv-active。
          navigationIntentRef.current = "home";
        } else {
          setHomeFocusRequest((current) => current + 1);
        }
      });
    },
  }), [input.inputProps, input.onStartNewConversation]);

  const conversationInput = useMemo<ChatInputProps>(() => ({
    ...input.inputProps,
    autoFocus: true,
    placeholder: input.conversation === undefined ? "从一个想法开始" : "继续对话...",
  }), [input.conversation, input.inputProps]);

  return {
    view,
    brainSelectedId,
    spaceTargetId,
    activeSpaceId,
    homeFocusRequest,
    homeInput,
    conversationInput,
    navigate,
    onBrainSelect: setBrainSelectedId,
    onActiveSpaceChange: setActiveSpaceId,
    onOpenInSpace: (spaceId, id) => {
      setActiveSpaceId(spaceId);
      setSpaceTargetId(id);
      setView("space");
    },
  };
}

/** Only the run status decides the *initial* view (startup restore with no user
 * intent yet). It is deliberately not used to hijack later explicit
 * navigation: a running run or pending confirmation never forces the user
 * away from Home / Brain / Search / Space views.
 *
 * 全屏对话视图已退役（2026-08）：初始视图不再进入 conv-active / conv-done；
 * 运行中/待确认会话的恢复由组合根路由到所属空间的右侧对话面板。 */
export type WorkbenchInitialViewInput = {
  readonly currentRun: { readonly run?: { readonly status: TaskStatus } };
  readonly pendingConfirmation?: WorkbenchNavigationInput["pendingConfirmation"];
};

export function initialView(input: WorkbenchInitialViewInput): View {
  return "home";
}

export function requiresImmediateConversationView(
  input: WorkbenchInitialViewInput,
): boolean {
  return input.pendingConfirmation !== undefined || input.currentRun.run?.status === "running";
}
