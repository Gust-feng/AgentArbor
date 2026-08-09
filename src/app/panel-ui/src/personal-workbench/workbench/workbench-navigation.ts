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
          navigationIntentRef.current = "conv-active";
          setView("conv-active");
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
 * away from Home / Brain / Search / Space views. */
export type WorkbenchInitialViewInput = {
  readonly currentRun: { readonly run?: { readonly status: TaskStatus } };
  readonly pendingConfirmation?: WorkbenchNavigationInput["pendingConfirmation"];
};

export function initialView(input: WorkbenchInitialViewInput): View {
  return requiresImmediateConversationView(input) ? "conv-active" : "home";
}

export function requiresImmediateConversationView(
  input: WorkbenchInitialViewInput,
): boolean {
  return input.pendingConfirmation !== undefined || input.currentRun.run?.status === "running";
}
