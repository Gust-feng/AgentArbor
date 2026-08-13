import {
  lazy,
  Suspense,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudOff,
  Cpu,
  EllipsisVertical,
  Laptop,
  Layers,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Shield,
  Smartphone,
  Square,
  Settings2,
  Unplug,
  WifiOff,
  X,
} from "lucide-react";

import type { MobilePendingConversation } from "./storage";
import { createClientId, type MobileRemoteState, type RemoteMobileClient } from "./remote-client";
import { mobileModelInitial, resolveMobileModelIcon } from "./model-icons";
import { useConversationController } from "./use-conversation-controller";
import { errorMessage } from "./mobile-error";
import { formatRelativeTime } from "./mobile-format";
import { useModalFocus } from "./use-modal-focus";
import { useMobileBackHandler } from "./use-mobile-back-handler";
import { IconButton, Notice } from "./mobile-ui-primitives";
import {
  projectSpaces,
  type SpaceItem,
} from "./vault-projection";

type PrimarySection = "home" | "profile";
type CoreMobileRoute =
  | { readonly kind: "home" }
  | { readonly kind: "space"; readonly spaceId: string }
  | { readonly kind: "conversation"; readonly conversationId: string; readonly returnTo: CoreMobileRoute };
/**
 * The current mobile release deliberately exposes only the Space → Conversation
 * workbench. Vault content remains a backend capability and must not gain a
 * mobile route until its dedicated content surface and sync UX are ready.
 */
type MobileRoute =
  | CoreMobileRoute
  | { readonly kind: "profile"; readonly returnTo: CoreMobileRoute };
type MobileTheme = "light" | "dark";
type ModelPickerTarget = { readonly kind: "new_conversation" } | { readonly kind: "conversation"; readonly conversationId: string };
type MobileModelOption = NonNullable<MobileRemoteState["modelOptions"]>[number];

type PendingConversation = {
  readonly commandId: string;
  readonly knownIds: ReadonlySet<string>;
  readonly message: string;
  readonly spaceId: string;
};
type MobileOverlay =
  | { readonly kind: "quick_menu" }
  | { readonly kind: "owner_picker" }
  | { readonly kind: "new_space" }
  | { readonly kind: "confirm_forget_device" }
  | { readonly kind: "model_picker"; readonly target: ModelPickerTarget };

function routeView(route: MobileRoute): "primary" | "space" | "conversation" {
  if (route.kind === "space") return "space";
  if (route.kind === "conversation") return "conversation";
  return "primary";
}

function routeSection(route: MobileRoute): PrimarySection {
  if (route.kind === "profile") return "profile";
  return "home";
}

function coreRoute(route: MobileRoute): CoreMobileRoute {
  return route.kind === "profile" ? route.returnTo : route;
}

const DEFAULT_RELAY_URL = import.meta.env.VITE_AGENTARBOR_RELAY_URL?.trim() ?? "";
const MOBILE_SELECTED_SPACE_KEY = "agentarbor:mobile-selected-space";
const MOBILE_THEME_SURFACE = { light: "#f4f2ef", dark: "#181916" } as const;
const CompletedMarkdownContent = lazy(() => import("./completed-markdown"));

export function App({ client }: { readonly client: RemoteMobileClient }) {
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const [route, setRoute] = useState<MobileRoute>({ kind: "home" });
  const [overlay, setOverlay] = useState<MobileOverlay>();
  // A draft belongs to its Space. Keeping one global draft made switching
  // Spaces silently carry text into the wrong conversation context.
  const [spaceDrafts, setSpaceDrafts] = useState<Readonly<Record<string, string>>>({});
  const [lastSpaceId, setLastSpaceId] = useState<string | undefined>(() => localStorage.getItem(MOBILE_SELECTED_SPACE_KEY) ?? undefined);
  const [pendingConversation, setPendingConversation] = useState<PendingConversation>();
  const [actionError, setActionError] = useState<string>();
  const [defaultModelId, setDefaultModelId] = useState<string>();
  const [conversationModelIds, setConversationModelIds] = useState<Readonly<Record<string, string>>>({});
  const theme = useMobileTheme();

  useSystemThemeColor(theme);

  useEffect(() => {
    void client.start();
    return () => client.release();
  }, [client]);

  const spaces = useMemo(() => projectSpaces(state), [state.vaultResources]);
  const modelOptions = state.modelOptions ?? [];
  const quickMenuOpen = overlay?.kind === "quick_menu";
  const overlayIsModal = overlay !== undefined && overlay.kind !== "quick_menu";
  const connection = useMemo(() => connectionPresentation(state), [state.connection, state.peerOnline]);
  const view = routeView(route);
  const section = routeSection(route);
  const selectedSpaceId = route.kind === "space" ? route.spaceId : undefined;
  const selectedConversationId = route.kind === "conversation" ? route.conversationId : undefined;
  const defaultModel = modelOptions.find((option) => option.id === defaultModelId)
    ?? modelOptions.find((option) => option.isDefault)
    ?? modelOptions[0];
  const conversationModelId = selectedConversationId === undefined ? undefined : conversationModelIds[selectedConversationId];
  const conversationModel = modelOptions.find((option) => option.id === conversationModelId) ?? defaultModel;
  const changeRoute = useCallback((next: MobileRoute): void => {
    // Do not capture the whole WebView for a route update. Android may
    // recalculate safe-area insets while a root view transition is running;
    // that makes local overlay changes (notably the model sheet) flash and
    // shifts the composer. Individual surfaces can still own small motion.
    setRoute(next);
  }, []);
  const updateSpaceDraft = useCallback((spaceId: string, value: string): void => {
    setSpaceDrafts((current) => {
      if (value.length === 0) {
        if (!(spaceId in current)) return current;
        const { [spaceId]: _cleared, ...remaining } = current;
        return remaining;
      }
      return { ...current, [spaceId]: value };
    });
  }, []);
  const restorePendingDraft = useCallback((pending: PendingConversation): void => {
    setSpaceDrafts((current) => {
      const existing = current[pending.spaceId];
      return existing?.trim().length > 0
        ? current
        : { ...current, [pending.spaceId]: pending.message };
    });
  }, []);
  const selectedSpace = spaces.find((space) => space.id === selectedSpaceId);
  const lastSpace = spaces.find((space) => space.id === lastSpaceId);
  const selectedConversation = selectedConversationId === undefined
    ? undefined
    : state.conversations.find((conversation) => conversation.conversationId === selectedConversationId);
  const selectedConversationSpace = selectedConversation?.spaceId === undefined
    ? undefined
    : spaces.find((space) => space.id === selectedConversation.spaceId);
  const openProfile = useCallback((): void => {
    const returnTo = coreRoute(route);
    setOverlay(undefined);
    changeRoute({ kind: "profile", returnTo });
  }, [changeRoute, route]);

  const closeSecondary = useCallback((): void => {
    if (route.kind === "profile") changeRoute(route.returnTo);
  }, [changeRoute, route]);

  useEffect(() => {
    if (state.connection === "loading") return;
    if (lastSpaceId !== undefined) {
      if (!spaces.some((space) => space.id === lastSpaceId)) setLastSpaceId(undefined);
      return;
    }
    if (spaces.length === 1) setLastSpaceId(spaces[0]?.id);
  }, [lastSpaceId, spaces]);

  useEffect(() => {
    if (lastSpaceId === undefined) localStorage.removeItem(MOBILE_SELECTED_SPACE_KEY);
    else localStorage.setItem(MOBILE_SELECTED_SPACE_KEY, lastSpaceId);
  }, [lastSpaceId]);

  useEffect(() => {
    if (route.kind === "space" && selectedSpace === undefined) {
      changeRoute({ kind: "home" });
      return;
    }
  }, [changeRoute, route.kind, selectedSpace]);

  useEffect(() => {
    if (route.kind !== "conversation" || selectedConversationId === undefined) return;
    if (selectedConversation !== undefined) return;
    const returnTo = route.returnTo;
    changeRoute(returnTo.kind === "space" && !spaces.some((space) => space.id === returnTo.spaceId)
      ? { kind: "home" }
      : returnTo);
  }, [changeRoute, route, selectedConversation, selectedConversationId, spaces]);

  useEffect(() => {
    if (pendingConversation === undefined) return;
    const result = state.commandResults.find((candidate) => candidate.commandId === pendingConversation.commandId);
    if (result === undefined) return;
    if (result?.status === "failed" || result?.status === "conflict") {
      setActionError(result.error?.message ?? "消息未能发送");
      restorePendingDraft(pendingConversation);
      setPendingConversation(undefined);
      return;
    }
    const resultConversationId = typeof result?.entity?.conversationId === "string"
      ? result.entity.conversationId
      : undefined;
    const candidates = resultConversationId === undefined
      ? state.conversations.filter((conversation) =>
        !pendingConversation.knownIds.has(conversation.conversationId)
        && conversation.spaceId === pendingConversation.spaceId,
      )
      : [];
    if (resultConversationId === undefined && candidates.length > 1) {
      setActionError("电脑未返回明确的新对话，请稍后重试");
      restorePendingDraft(pendingConversation);
      setPendingConversation(undefined);
      return;
    }
    const created = resultConversationId === undefined
      ? candidates[0]
      : state.conversations.find((conversation) => conversation.conversationId === resultConversationId);
    if (created === undefined) return;
    if (created.spaceId !== pendingConversation.spaceId
      || !spaces.some((space) => space.id === created.spaceId)) {
      setActionError("电脑返回的对话不属于当前空间，请保留草稿后重试");
      restorePendingDraft(pendingConversation);
      setPendingConversation(undefined);
      return;
    }
    const returnTo: CoreMobileRoute = { kind: "space", spaceId: pendingConversation.spaceId };
    setPendingConversation(undefined);
    changeRoute({ kind: "conversation", conversationId: created.conversationId, returnTo });
  }, [changeRoute, pendingConversation, restorePendingDraft, spaces, state.commandResults, state.conversations]);

  useMobileBackHandler(() => {
    if (overlay !== undefined) {
      setOverlay(undefined);
      return true;
    }
    if (route.kind === "conversation") {
      changeRoute(route.returnTo);
      return true;
    }
    if (route.kind === "space") {
      changeRoute({ kind: "home" });
      return true;
    }
    if (route.kind === "profile") {
      closeSecondary();
      return true;
    }
    return false;
  });

  if (state.connection === "loading") return <LoadingScreen />;
  if (state.connection === "unpaired" || state.connection === "pairing") {
    return <PairingScreen client={client} state={state} />;
  }

  const submitConversation = async (message: string, spaceId = lastSpace?.id): Promise<void> => {
    const content = message.trim();
    if (content.length === 0) return;
    if (spaceId === undefined) {
      setOverlay({ kind: "owner_picker" });
      return;
    }
    setActionError(undefined);
    const knownIds = new Set(state.conversations.map((conversation) => conversation.conversationId));
    try {
      const commandId = await client.sendCommand({
        kind: "conversation.submit",
        message: content,
        spaceId,
        ...(defaultModel === undefined ? {} : { modelSelectionId: defaultModel.id }),
      });
      setPendingConversation({ commandId, knownIds, message: content, spaceId });
      updateSpaceDraft(spaceId, "");
    } catch (cause) {
      setActionError(errorMessage(cause, "消息未能保存"));
    }
  };

  const openSpace = (spaceId: string): void => {
    setLastSpaceId(spaceId);
    setOverlay(undefined);
    changeRoute({ kind: "space", spaceId });
  };

  const openConversation = (conversationId: string): void => {
    const conversation = state.conversations.find((candidate) => candidate.conversationId === conversationId);
    const owner = conversation?.spaceId === undefined
      ? undefined
      : spaces.find((space) => space.id === conversation.spaceId);
    if (conversation === undefined || owner === undefined) {
      setActionError("这段对话没有可用的所属空间");
      return;
    }
    setLastSpaceId(owner.id);
    setOverlay(undefined);
    changeRoute({ kind: "conversation", conversationId, returnTo: { kind: "space", spaceId: owner.id } });
  };

  return (
    <div className="aa-mobile-shell" data-section={section} data-view={view} spellCheck={false}>
      <div
        className="aa-mobile-route-surface"
        aria-hidden={overlayIsModal || undefined}
        inert={overlayIsModal}
      >
      {route.kind === "home" && (
        <>
          <MobileTopBar
            title=""
            connection={connection}
            quickMenuOpen={quickMenuOpen}
            onOpenQuickMenu={() => setOverlay({ kind: "quick_menu" })}
          />
          <main className="aa-mobile-main">
            <HomeView
              spaces={spaces}
              onOpenSpace={openSpace}
              onCreateSpace={() => setOverlay({ kind: "new_space" })}
              error={actionError}
            />
          </main>
        </>
      )}

      {route.kind === "profile" && (
        <ProfileView
          state={state}
          actionError={actionError}
          onBack={closeSecondary}
          onRequestForget={() => setOverlay({ kind: "confirm_forget_device" })}
        />
      )}

      {route.kind === "space" && selectedSpace !== undefined && (
        <SpaceView
          key={selectedSpace.id}
          state={state}
          connection={connection}
          space={selectedSpace}
          tone={spaceTone(selectedSpace.id)}
          quickMenuOpen={quickMenuOpen}
          conversationIds={state.conversations
            .filter((conversation) => conversation.spaceId === selectedSpace.id)
            .map((conversation) => conversation.conversationId)}
          pendingConversations={state.pendingConversations.filter((entry) => entry.spaceId === selectedSpace.id)}
          draft={spaceDrafts[selectedSpace.id] ?? ""}
          pending={pendingConversation?.spaceId === selectedSpace.id
            || state.pendingConversations.some((entry) => entry.spaceId === selectedSpace.id)}
          model={defaultModel}
          onBack={() => changeRoute({ kind: "home" })}
          onOpenQuickMenu={() => setOverlay({ kind: "quick_menu" })}
          onDraftChange={(value) => updateSpaceDraft(selectedSpace.id, value)}
          onSubmit={() => void submitConversation(spaceDrafts[selectedSpace.id] ?? "", selectedSpace.id)}
          onSelectModel={() => setOverlay({ kind: "model_picker", target: { kind: "new_conversation" } })}
          onOpenConversation={openConversation}
          onResumePendingConversation={(pending) => {
            setLastSpaceId(pending.spaceId);
            updateSpaceDraft(pending.spaceId, pending.message);
            setPendingConversation({
              commandId: pending.commandId,
              knownIds: new Set(state.conversations.map((conversation) => conversation.conversationId)),
              message: pending.message,
              spaceId: pending.spaceId,
            });
          }}
          error={actionError}
        />
      )}

      {route.kind === "conversation" && selectedConversationId !== undefined && selectedConversation !== undefined && (
        <ConversationView
          key={selectedConversationId}
          client={client}
          state={state}
          connection={connection}
          conversationId={selectedConversationId}
          ownerLabel={selectedConversationSpace?.title ?? "归属同步中"}
          ownerTone={selectedConversationSpace === undefined ? undefined : spaceTone(selectedConversationSpace.id)}
          ownerAvailable={selectedConversationSpace !== undefined}
          quickMenuOpen={quickMenuOpen}
          onBack={() => changeRoute(route.returnTo)}
          onOpenOwner={() => {
            if (selectedConversationSpace !== undefined) openSpace(selectedConversationSpace.id);
          }}
          onOpenQuickMenu={() => setOverlay({ kind: "quick_menu" })}
          model={conversationModel}
          modelSelectionId={conversationModel?.id}
          onSelectModel={() => setOverlay({ kind: "model_picker", target: { kind: "conversation", conversationId: selectedConversationId } })}
        />
      )}
      </div>

      {overlay?.kind === "quick_menu" && (
        <QuickMenu
          onClose={() => setOverlay(undefined)}
          onOpenProfile={openProfile}
          onCreateSpace={() => setOverlay({ kind: "new_space" })}
        />
      )}

      {overlay?.kind === "new_space" && (
        <NewSpaceDialog
          client={client}
          onClose={() => setOverlay(undefined)}
          onCreated={openSpace}
        />
      )}

      {overlay?.kind === "owner_picker" && (
        <OwnerPickerSheet
          spaces={spaces}
          selectedId={lastSpace?.id}
          onClose={() => setOverlay(undefined)}
          onSelect={(spaceId) => {
            setLastSpaceId(spaceId);
            setOverlay(undefined);
          }}
          onCreateSpace={() => {
            setOverlay({ kind: "new_space" });
          }}
        />
      )}
      {overlay?.kind === "model_picker" && (
        <ModelPicker
          options={modelOptions}
          selectedId={overlay.target.kind === "conversation" ? conversationModel?.id : defaultModel?.id}
          onClose={() => setOverlay(undefined)}
          onSelect={(id) => {
            if (overlay.target.kind === "conversation") {
              const { conversationId } = overlay.target;
              setConversationModelIds((current) => ({ ...current, [conversationId]: id }));
            } else {
              setDefaultModelId(id);
            }
            setOverlay(undefined);
          }}
        />
      )}
      {overlay?.kind === "confirm_forget_device" && (
        <ForgetDeviceDialog
          client={client}
          onClose={() => setOverlay(undefined)}
          onForgot={() => setOverlay(undefined)}
        />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div
      className="aa-mobile-bootstrap-loading"
      role="status"
      aria-live="polite"
      aria-label="正在准备工作台"
    >
      <span className="aa-mobile-visually-hidden">正在准备工作台</span>
    </div>
  );
}

function PairingScreen({ client, state }: ScreenProps) {
  const [relayUrl, setRelayUrl] = useState(() =>
    (globalThis as typeof globalThis & { __AGENTARBOR_RELAY_URL__?: string }).__AGENTARBOR_RELAY_URL__
      ?? DEFAULT_RELAY_URL);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pairing = state.pairing;

  useEffect(() => {
    if (pairing === undefined || pairing.status === "expired" || pairing.status === "rejected") return;
    const timer = window.setInterval(() => void client.inspectPairing().catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [client, pairing?.pairingId, pairing?.status]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.joinPairing(relayUrl, code, "我的手机");
    } catch (cause) {
      setError(errorMessage(cause, "无法加入配对"));
    } finally {
      setBusy(false);
    }
  };

  const scanPairingCode = async () => {
    setError(undefined);
    try {
      const {
        CapacitorBarcodeScanner,
        CapacitorBarcodeScannerAndroidScanningLibrary,
        CapacitorBarcodeScannerCameraDirection,
        CapacitorBarcodeScannerScanOrientation,
        CapacitorBarcodeScannerTypeHint,
      } = await import("@capacitor/barcode-scanner");
      const result = await CapacitorBarcodeScanner.scanBarcode({
        hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
        scanInstructions: "扫描电脑上的配对二维码",
        scanButton: false,
        cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
        scanOrientation: CapacitorBarcodeScannerScanOrientation.PORTRAIT,
        android: { scanningLibrary: CapacitorBarcodeScannerAndroidScanningLibrary.MLKIT },
      });
      const payload = new URL(result.ScanResult);
      if (payload.protocol !== "agentarbor:" || payload.hostname !== "pair") throw new Error("这不是 AgentArbor 配对二维码");
      const nextRelay = payload.searchParams.get("relay") ?? "";
      const nextCode = payload.searchParams.get("code") ?? "";
      const parsedRelay = new URL(nextRelay);
      if (!["https:", "http:"].includes(parsedRelay.protocol) || !/^\d{6}$/u.test(nextCode)) throw new Error("配对二维码内容无效");
      setRelayUrl(parsedRelay.toString().replace(/\/$/u, ""));
      setCode(nextCode);
    } catch (cause) {
      setError(errorMessage(cause, "无法扫描配对二维码"));
    }
  };

  if (pairing !== undefined) {
    const unavailable = pairing.status === "expired" || pairing.status === "rejected";
    return (
      <div className="aa-mobile-pairing-page">
        <main className="aa-mobile-pairing-main">
          <div className="aa-mobile-pairing-devices" aria-hidden="true"><Smartphone /><span /><Laptop /></div>
          <p className="aa-mobile-eyebrow">{unavailable ? "配对未完成" : "等待电脑批准"}</p>
          <h1>{pairing.peerDeviceName ?? "电脑端"}</h1>
          <div className="aa-mobile-pairing-code" aria-label={`配对码 ${pairing.pairingCode}`}>
            <span>{pairing.pairingCode.slice(0, 3)}</span><i /><span>{pairing.pairingCode.slice(3)}</span>
          </div>
          {unavailable ? (
            <>
              <Notice>{pairing.status === "expired" ? "配对码已过期" : "电脑拒绝了此次连接"}</Notice>
              <button className="aa-mobile-primary-button" onClick={() => void client.forgetDevice()}>重新配对</button>
            </>
          ) : (
            <div className="aa-mobile-pairing-waiting" role="status"><LoaderCircle className="spin" /><span>请在电脑端批准连接</span></div>
          )}
          <button className="aa-mobile-text-button" disabled={unavailable} onClick={() => void client.inspectPairing()}><RefreshCw />刷新</button>
          {error && <Notice>{error}</Notice>}
        </main>
      </div>
    );
  }

  return (
    <div className="aa-mobile-pairing-page">
      <main className="aa-mobile-pairing-main">
        <p className="aa-mobile-eyebrow">移动协同</p>
        <h1>连接电脑</h1>
        <form className="aa-mobile-pairing-form" onSubmit={submit}>
          <label htmlFor="pairing-code">配对码</label>
          <input
            id="pairing-code"
            value={code}
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            spellCheck={false}
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
          />
          <button type="button" className="aa-mobile-scan-button" onClick={() => void scanPairingCode()}><ScanLine />扫描二维码</button>
          <button className="aa-mobile-primary-button" disabled={busy || relayUrl.length === 0 || code.length !== 6}>
            {busy ? <LoaderCircle className="spin" /> : <ChevronRight />}继续
          </button>
        </form>
        {relayUrl.length === 0 && <Notice>当前安装包未配置协同服务。</Notice>}
        {error && <Notice>{error}</Notice>}
      </main>
    </div>
  );
}

function MobileTopBar(props: {
  readonly title: string;
  readonly connection: { readonly label: string; readonly tone: string };
  readonly quickMenuOpen: boolean;
  readonly onOpenQuickMenu: () => void;
}) {
  return (
    <header className="aa-mobile-topbar" aria-label={props.title === "" ? "工作台" : undefined}>
      <span className="aa-mobile-header-spacer" aria-hidden="true" />
      <strong className="aa-mobile-topbar-title">{props.title}</strong>
      <div className="aa-mobile-header-actions">
        <MobileConnectionIndicator presentation={props.connection} />
        <QuickMenuTrigger open={props.quickMenuOpen} onOpen={props.onOpenQuickMenu} />
      </div>
    </header>
  );
}

function QuickMenuTrigger(props: { readonly open: boolean; readonly onOpen: () => void }) {
  return (
    <IconButton
      label="打开快捷菜单"
      ariaControls="mobile-quick-menu"
      ariaExpanded={props.open}
      ariaHasPopup="menu"
      onClick={props.onOpen}
    >
      <EllipsisVertical />
    </IconButton>
  );
}

function MobileConnectionIndicator({ presentation }: { readonly presentation: { readonly label: string; readonly tone: string } }) {
  return (
    <span className="aa-mobile-connection-indicator" data-tone={presentation.tone} role="status" aria-label={presentation.label} title={presentation.label}>
      <i aria-hidden="true" />
      <span>{presentation.label}</span>
    </span>
  );
}

function HomeView(props: {
  readonly spaces: readonly SpaceItem[];
  readonly onOpenSpace: (spaceId: string) => void;
  readonly onCreateSpace: () => void;
  readonly error?: string;
}) {
  return (
    <SpaceIndexView
      spaces={props.spaces}
      onOpenSpace={props.onOpenSpace}
      onCreateSpace={props.onCreateSpace}
      error={props.error}
    />
  );
}

function SpaceIndexView(props: {
  readonly spaces: readonly SpaceItem[];
  readonly onOpenSpace: (spaceId: string) => void;
  readonly onCreateSpace: () => void;
  readonly error?: string;
}) {
  const hasSpaces = props.spaces.length > 0;
  return (
    <section className="aa-mobile-home aa-mobile-space-home" aria-label="空间列表">
      <div className="aa-mobile-home-space-index">
        <div className="aa-mobile-home-space-list">
          {hasSpaces ? props.spaces.map((space) => (
            <button
              type="button"
              className="aa-mobile-home-space-row"
              key={space.id}
              aria-label={space.title}
              onClick={() => props.onOpenSpace(space.id)}
            >
              <span className="aa-mobile-home-space-mark" data-tone={spaceTone(space.id)} aria-hidden="true" />
              <span className="aa-mobile-home-space-copy">
                <strong>{space.title}</strong>
              </span>
            </button>
          )) : (
            <div className="aa-mobile-home-space-empty">
              <span className="aa-mobile-home-empty-icon" aria-hidden="true"><Layers /></span>
              <strong>还没有空间</strong>
              <small>每段会话都需要一个归属。创建空间后，就可以从这里开始。</small>
              <button
                type="button"
                className="aa-mobile-home-empty-action"
                aria-label="还没有空间，新建空间"
                onClick={props.onCreateSpace}
              >
                <Plus aria-hidden="true" />新建空间
              </button>
            </div>
          )}
        </div>
      </div>

      {props.error && <Notice>{props.error}</Notice>}
    </section>
  );
}

function Composer(props: {
  readonly className?: string;
  readonly draft: string;
  readonly pending?: boolean;
  readonly compact?: boolean;
  /** Render the larger Space composer toolbar used by the existing controls. */
  readonly toolbar?: boolean;
  readonly toolbarContent?: ReactNode;
  readonly placeholder?: string;
  readonly footer?: ReactNode;
  readonly submitDisabled?: boolean;
  readonly submitting?: boolean;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (props.draft.length === 0 && fieldRef.current !== null) fieldRef.current.style.height = "";
  }, [props.draft]);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    props.onSubmit();
  };
  const submitLabel = props.submitting ? "正在发送" : "发送";
  const submitIcon = props.submitting ? <LoaderCircle className="spin" /> : <ArrowUp />;
  return (
    <form className={`aa-mobile-composer ${props.compact ? "compact" : ""} ${props.className ?? ""}`} onSubmit={submit}>
      <div className="aa-mobile-composer-line">
        <textarea
          ref={fieldRef}
          rows={1}
          value={props.draft}
          aria-label="输入消息"
          placeholder={props.placeholder ?? "输入消息"}
          spellCheck={false}
          onInput={resizeComposer}
          onChange={(event) => props.onDraftChange(event.target.value)}
        />
        {!props.toolbar && (
          <button type="submit" aria-label={submitLabel} title={submitLabel} disabled={props.draft.trim().length === 0 || props.pending || props.submitDisabled}>{submitIcon}</button>
        )}
      </div>
      {props.toolbar ? (
        <div className="aa-mobile-composer-toolbar">
          <div className="aa-mobile-composer-toolbar-leading">
            {props.toolbarContent}
          </div>
          <div className="aa-mobile-composer-toolbar-trailing">
            <button type="submit" className="aa-mobile-composer-send" aria-label={submitLabel} title={submitLabel} disabled={props.draft.trim().length === 0 || props.pending || props.submitDisabled}>{submitIcon}</button>
          </div>
        </div>
      ) : props.footer}
    </form>
  );
}

function SpaceView(props: {
  readonly state: MobileRemoteState;
  readonly connection: { readonly label: string; readonly tone: string };
  readonly space: SpaceItem;
  readonly tone: number;
  readonly quickMenuOpen: boolean;
  readonly conversationIds: readonly string[];
  readonly pendingConversations: readonly MobilePendingConversation[];
  readonly draft: string;
  readonly pending: boolean;
  readonly model?: MobileModelOption;
  readonly onBack: () => void;
  readonly onOpenQuickMenu: () => void;
  readonly onDraftChange: (value: string) => void;
  readonly onSubmit: () => void;
  readonly onSelectModel: () => void;
  readonly onOpenConversation: (conversationId: string) => void;
  readonly onResumePendingConversation: (pending: MobilePendingConversation) => void;
  readonly error?: string;
}) {
  const conversations = props.conversationIds
    .map((id) => props.state.conversations.find((conversation) => conversation.conversationId === id))
    .filter((conversation): conversation is MobileRemoteState["conversations"][number] => conversation !== undefined);
  return (
    <section className="aa-mobile-detail-page aa-mobile-space-page">
      <header className="aa-mobile-space-header" aria-label={`${props.space.title}空间导航`}>
        <IconButton label="返回" onClick={props.onBack}><ArrowLeft /></IconButton>
        <span className="aa-mobile-space-header-spacer" aria-hidden="true" />
        <div className="aa-mobile-header-actions">
          <MobileConnectionIndicator presentation={props.connection} />
          <QuickMenuTrigger open={props.quickMenuOpen} onOpen={props.onOpenQuickMenu} />
        </div>
      </header>
      <div className="aa-mobile-detail-scroll">
        <div className="aa-mobile-space-intro">
          <h1 className="aa-mobile-space-hero-title">
            <span className="aa-mobile-space-identity-mark" data-tone={props.tone} data-initial={spaceInitial(props.space.title)} aria-hidden="true" />
            <span>{props.space.title}</span>
          </h1>
          <Composer
            className="aa-mobile-space-composer"
            draft={props.draft}
            pending={props.pending}
            toolbar
            placeholder="询问任何问题，创造任何事物"
            toolbarContent={(
              <ModelSelectorButton
                className="aa-mobile-home-context-button aa-mobile-home-model-button aa-mobile-space-model-button"
                labelPrefix="当前模型："
                model={props.model}
                onClick={props.onSelectModel}
              />
            )}
            submitDisabled={props.pending}
            onDraftChange={props.onDraftChange}
            onSubmit={props.onSubmit}
          />
        </div>
        {props.error && <Notice>{props.error}</Notice>}
        <div className="aa-mobile-space-sections">
          <ConversationSection title="对话">
            {conversations.length === 0 && props.pendingConversations.length === 0 ? <p className="aa-mobile-empty-row">暂无对话</p> : (
              <>
                {props.pendingConversations.map((pending) => (
                  <button
                    className="aa-mobile-conversation-row aa-mobile-conversation-row-pending"
                    type="button"
                    key={`pending:${pending.commandId}`}
                    onClick={() => props.onResumePendingConversation(pending)}
                  >
                    <span className="aa-mobile-conversation-mark" data-status="pending" aria-hidden="true" />
                    <span><strong>{pending.message}</strong><small>待发送 · {formatRelativeTime(pending.createdAt)}</small></span>
                    <ChevronRight />
                  </button>
                ))}
                {conversations
                  .slice()
                  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
                  .map((conversation) => (
                    <button className="aa-mobile-conversation-row" type="button" key={conversation.conversationId} onClick={() => props.onOpenConversation(conversation.conversationId)}>
                    <span className="aa-mobile-conversation-mark" data-status={conversation.status} aria-hidden="true" />
                      <span><strong>{conversation.title || "未命名对话"}</strong><small>{conversationMetaText(conversation.status, conversation.updatedAt)}</small></span>
                      <ChevronRight />
                    </button>
                  ))}
              </>
            )}
          </ConversationSection>

        </div>
      </div>
    </section>
  );
}

function ConversationView(props: {
  readonly client: RemoteMobileClient;
  readonly state: MobileRemoteState;
  readonly connection: { readonly label: string; readonly tone: string };
  readonly conversationId: string;
  readonly ownerLabel: string;
  readonly ownerTone?: number;
  readonly ownerAvailable: boolean;
  readonly quickMenuOpen: boolean;
  readonly onBack: () => void;
  readonly onOpenOwner: () => void;
  readonly onOpenQuickMenu: () => void;
  readonly model?: MobileModelOption;
  readonly modelSelectionId?: string;
  readonly onSelectModel: () => void;
}) {
  const controller = useConversationController({
    client: props.client,
    state: props.state,
    conversationId: props.conversationId,
    modelSelectionId: props.modelSelectionId,
  });
  const {
    cancel,
    cancelError,
    cancelState,
    canCancel,
    conversation,
    earlierError,
    draft,
    followLatestContent,
    hasUnreadLiveContent,
    liveRun,
    liveText,
    liveTurnExists,
    loadEarlier,
    loadingEarlier,
    pageError,
    observeTranscriptScroll,
    page,
    run,
    setDraft,
    submit,
    retryPage,
    submitState,
    submitError,
    transcriptRef,
  } = controller;
  const lifecycleStatus = run?.status ?? conversation?.status;
  const lifecycleText = conversationLifecycleText(lifecycleStatus, run?.pendingConfirmations.length ?? 0);
  const hasConversationContent = page?.turns.some((turn) => turn.content.trim().length > 0) || liveText.length > 0;
  const showEmptyConversation = page !== undefined
    && !hasConversationContent
    && lifecycleText === undefined
    && (run?.pendingConfirmations.length ?? 0) === 0;
  return (
    <section className="aa-mobile-conversation-page">
      <div className="aa-mobile-conversation-chrome">
        <header className="aa-mobile-conversation-header">
          <div className="aa-mobile-conversation-leading">
            <IconButton label="返回" onClick={props.onBack}><ArrowLeft /></IconButton>
            <button
              type="button"
              className="aa-mobile-conversation-title"
              aria-label={props.ownerLabel}
              aria-describedby="aa-mobile-conversation-title-description"
              disabled={!props.ownerAvailable}
              onClick={props.onOpenOwner}
            >
              <strong id="aa-mobile-conversation-title-description">{conversation?.title || "对话"}</strong>
              <span className="aa-mobile-conversation-owner" aria-hidden="true">
                {props.ownerTone === undefined
                  ? <Layers />
                  : <span className="aa-mobile-conversation-owner-mark" data-tone={props.ownerTone} />}
                {props.ownerLabel}{props.ownerAvailable && <ChevronRight />}
              </span>
            </button>
          </div>
          <div className="aa-mobile-conversation-actions">
            <MobileConnectionIndicator presentation={props.connection} />
            <QuickMenuTrigger open={props.quickMenuOpen} onOpen={props.onOpenQuickMenu} />
          </div>
        </header>
      </div>

      <div
        ref={transcriptRef}
        className="aa-mobile-transcript"
        role="log"
        aria-label="对话内容"
        aria-live={liveRun ? "off" : "polite"}
        aria-relevant="additions text"
        aria-busy={liveRun !== undefined || undefined}
        onScroll={(event) => observeTranscriptScroll(event.currentTarget)}
      >
        {page?.hasMore && (
          <>
            <button className="aa-mobile-load-earlier" disabled={loadingEarlier || !props.state.peerOnline} onClick={() => void loadEarlier()}>
              {loadingEarlier ? <LoaderCircle className="spin" /> : <ArrowUp />}更早内容
            </button>
            {earlierError && <p className="aa-mobile-load-earlier-error" role="status">{earlierError}</p>}
          </>
        )}
        {page === undefined ? (
          pageError !== undefined ? (
            <div className="aa-mobile-conversation-load-error" role="status">
              <CircleAlert />
              <strong>{pageError}</strong>
              <button type="button" disabled={!props.state.peerOnline} onClick={() => void retryPage()}>重试</button>
            </div>
          ) : (
            <QuietEmpty
              icon={props.state.peerOnline ? <LoaderCircle className="spin" /> : <WifiOff />}
              label={props.state.peerOnline ? "正在获取对话" : "电脑离线"}
            />
          )
        ) : showEmptyConversation ? (
          <QuietEmpty icon={<MessageSquare />} label="还没有对话内容" />
        ) : page.turns.map((turn) => {
          const streamed = liveRun && turn.role === "assistant" && turn.runId === run?.runId && liveText.length > 0;
          const assistantText = turn.role === "assistant" && turn.content.trim().length > 0
            ? turn.content
            : undefined;
          return turn.role === "user" ? (
            <div className="aa-mobile-user-message" key={turn.turnId}><p>{turn.content}</p></div>
          ) : streamed || assistantText !== undefined ? (
            <article className="aa-mobile-assistant-message" key={turn.turnId}>
              <div>{streamed
                ? <p className="aa-mobile-stream-text">{liveText}</p>
                : <CompletedMarkdown text={assistantText!} />}
              </div>
            </article>
          ) : null;
        })}
        {!liveTurnExists && liveText.length > 0 && (
          <article className="aa-mobile-assistant-message">
            <div>{liveRun ? <p className="aa-mobile-stream-text">{liveText}</p> : <CompletedMarkdown text={liveText} />}</div>
          </article>
        )}
        {lifecycleText !== undefined && (
          <div className="aa-mobile-run-state" role="status" data-status={lifecycleStatus}>
            <i aria-hidden="true" /><span>{lifecycleText}</span>
          </div>
        )}
        {run?.pendingConfirmations.map((confirmation) => (
          <ApprovalCard
            client={props.client}
            commandResults={props.state.commandResults}
            peerOnline={props.state.peerOnline}
            runId={run.runId}
            confirmation={confirmation}
            key={confirmation.confirmationId}
          />
        ))}
        {hasUnreadLiveContent && <button className="aa-mobile-new-content" type="button" aria-label="查看新内容" title="查看新内容" onClick={followLatestContent}><ArrowDown /></button>}
      </div>

      <div className="aa-mobile-conversation-composer-wrap">
        {(cancelError || submitError) && (
          <div className="aa-mobile-conversation-composer-error" role="status"><CircleAlert /><span>{cancelError ?? submitError}</span></div>
        )}
        <Composer
          compact
          draft={draft}
          placeholder="继续对话"
          footer={(
            <div className="aa-mobile-conversation-composer-footer">
              <div className="aa-mobile-conversation-footer-context">
                <ModelSelectorButton
                  className="aa-mobile-conversation-model"
                  labelPrefix="选择模型 · "
                  model={props.model}
                  onClick={props.onSelectModel}
                />
              </div>
              {canCancel && (
                <button
                  className="aa-mobile-stop-button"
                  type="button"
                  aria-label={cancelState === "idle" ? "停止运行" : "正在停止"}
                  disabled={!props.state.peerOnline || cancelState !== "idle"}
                  onClick={() => void cancel()}
                >
                  {cancelState === "idle" ? <Square /> : <LoaderCircle className="spin" />}
                  <span>{cancelState === "idle" ? "停止" : "停止中"}</span>
                </button>
              )}
            </div>
          )}
          onDraftChange={setDraft}
          submitDisabled={submitState === "sending"}
          submitting={submitState === "sending"}
          onSubmit={() => void submit()}
        />
      </div>
    </section>
  );
}

function ApprovalCard(props: {
  readonly client: RemoteMobileClient;
  readonly commandResults: MobileRemoteState["commandResults"];
  readonly peerOnline: boolean;
  readonly runId: string;
  readonly confirmation: MobileRemoteState["runs"][number]["pendingConfirmations"][number];
}) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [submission, setSubmission] = useState<"idle" | "sending" | "submitted" | "failed">("idle");
  const [commandId, setCommandId] = useState<string>();
  const [error, setError] = useState<string>();
  const resumeLost = props.confirmation.resumeAvailability === "lost_after_restart";
  const riskPrefix = props.confirmation.riskLevel === "high"
    ? "高风险 · "
    : props.confirmation.riskLevel === "medium"
      ? "需留意 · "
      : "";
  const commandResult = commandId === undefined
    ? undefined
    : props.commandResults.find((candidate) => candidate.commandId === commandId);
  useEffect(() => {
    if (commandResult === undefined) return;
    if (commandResult.status === "applied") {
      setSubmission("submitted");
      return;
    }
    setSubmission("failed");
    setError(commandResult.error?.message ?? "电脑未能应用这项决定");
  }, [commandResult?.commandId, commandResult?.status, commandResult?.error?.message]);
  const decide = async (decision: "approve_once" | "deny" | "guidance"): Promise<void> => {
    if (!props.peerOnline || submission === "sending" || submission === "submitted") return;
    if (resumeLost && decision !== "deny") return;
    setCommandId(undefined);
    setSubmission("sending");
    setError(undefined);
    try {
      const nextCommandId = await props.client.sendCommand({
        kind: "confirmation.decide",
        runId: props.runId,
        confirmationId: props.confirmation.confirmationId,
        decision,
        ...(decision === "guidance" ? { guidance: guidance.trim() } : {}),
      });
      setCommandId(nextCommandId);
    } catch (cause) {
      setError(errorMessage(cause, "未能提交决定"));
      setSubmission("failed");
    }
  };
  const disabled = !props.peerOnline || submission === "sending" || submission === "submitted";
  const actionDisabled = disabled || resumeLost;
  const approvalTitleId = `mobile-approval-title-${props.confirmation.confirmationId}`;
  const approvalSummaryId = `mobile-approval-summary-${props.confirmation.confirmationId}`;
  return (
    <article className="aa-mobile-approval" data-risk={props.confirmation.riskLevel} aria-labelledby={approvalTitleId} aria-describedby={approvalSummaryId}>
      <header>
        <Shield />
        <strong id={approvalTitleId}>{props.confirmation.title}</strong>
      </header>
      <p id={approvalSummaryId} className="aa-mobile-approval-summary">{props.confirmation.actionSummary}</p>
      {(riskPrefix || props.confirmation.consequence) && (
        <small data-level={props.confirmation.riskLevel}>
          <CircleAlert />
          <span>{riskPrefix}{props.confirmation.consequence ?? "此操作需要留意。"}</span>
        </small>
      )}
      {resumeLost && (
        <p className="aa-mobile-approval-status aa-mobile-approval-resume-lost" role="status">
          电脑已重启，这次操作无法原地继续。请先不执行，再重新发起任务。
        </p>
      )}
      {props.confirmation.affectedResources.length > 0 && (
        <details className="aa-mobile-approval-resources">
          <summary>影响范围 · {props.confirmation.affectedResources.length}</summary>
          <ul>{props.confirmation.affectedResources.map((resource) => <li key={resource}>{resource}</li>)}</ul>
        </details>
      )}
      {guidanceOpen && <textarea autoFocus disabled={actionDisabled} value={guidance} aria-label="补充要求" spellCheck={false} onChange={(event) => setGuidance(event.target.value)} />}
      {!props.peerOnline && <p className="aa-mobile-approval-status" role="status">电脑离线，重新连接后再处理</p>}
      {(submission !== "idle" || error !== undefined) && (
      <p className="aa-mobile-approval-status" role="status" data-error={error !== undefined || undefined}>
          {submission === "sending" ? "等待电脑确认" : submission === "submitted" ? "电脑已应用" : error}
      </p>
      )}
      <div className="aa-mobile-approval-actions" role="group" aria-labelledby={approvalTitleId}>
        <button type="button" disabled={disabled} onClick={() => void decide("deny")}>不执行</button>
        <button type="button" disabled={actionDisabled} onClick={() => setGuidanceOpen((open) => !open)}>{guidanceOpen ? "取消" : "调整"}</button>
        {guidanceOpen ? (
          <button type="button" className="primary" disabled={actionDisabled || !guidance.trim()} onClick={() => void decide("guidance")}>发送</button>
        ) : (
          <button type="button" className="primary" disabled={actionDisabled} onClick={() => void decide("approve_once")}><Check />执行</button>
        )}
      </div>
    </article>
  );
}

function QuickMenu(props: {
  readonly onClose: () => void;
  readonly onOpenProfile: () => void;
  readonly onCreateSpace: () => void;
}) {
  const firstItemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    firstItemRef.current?.focus();
    return () => trigger?.focus();
  }, []);
  return (
    <div className="aa-mobile-quick-menu-layer" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <div
        id="mobile-quick-menu"
        className="aa-mobile-quick-menu"
        role="menu"
        aria-label="快捷操作"
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            props.onClose();
            return;
          }
          if (event.key !== "Escape") return;
          event.stopPropagation();
          props.onClose();
        }}
      >
        <button ref={firstItemRef} type="button" role="menuitem" onKeyDown={moveMenuSelection} onClick={props.onCreateSpace}>
          <Plus aria-hidden="true" />
          <span>新建空间</span>
        </button>
        <button type="button" role="menuitem" onKeyDown={moveMenuSelection} onClick={props.onOpenProfile}>
          <Settings2 aria-hidden="true" />
          <span>设置</span>
        </button>
      </div>
    </div>
  );
}

function ProfileView(props: {
  readonly state: MobileRemoteState;
  readonly actionError?: string;
  readonly onBack: () => void;
  readonly onRequestForget: () => void;
}) {
  const binding = props.state.binding;
  const connection = connectionPresentation(props.state);
  return (
    <section className="aa-mobile-detail-page aa-mobile-profile-page">
      <DetailHeader title="设置" onBack={props.onBack} />
      <div className="aa-mobile-account-content">
        <div className="aa-mobile-profile-identity">
          <span>{(binding?.displayName ?? "本").slice(0, 1).toUpperCase()}</span>
          <div><strong>{binding?.displayName ?? "本地账户"}</strong><small>@{binding?.accountHandle ?? "local"}</small></div>
        </div>
        {(props.state.error || props.actionError) && (
          <section className="aa-mobile-attention-list" aria-label="需要留意">
            {props.state.error && <p><CircleAlert />{props.state.error}</p>}
            {props.actionError && <p><CircleAlert />{props.actionError}</p>}
          </section>
        )}
        <section className="aa-mobile-settings-section">
          <span className="aa-mobile-eyebrow">设备</span>
          <div className="aa-mobile-settings-list" aria-label="设备">
            <div><Laptop /><span><strong>{binding?.peerDeviceName ?? "已配对电脑"}</strong><small>{connection.label}</small></span><i data-tone={connection.tone} /></div>
            <div><Smartphone /><span><strong>这台手机</strong><small>Android · 当前设备</small></span><span aria-hidden="true" /></div>
          </div>
        </section>
        {!props.state.peerOnline && (
          <div className="aa-mobile-sync-card offline">
            <span><CloudOff /></span>
            <div><strong>等待电脑连接</strong><small>重新打开电脑端连接后继续同步</small></div>
          </div>
        )}
        <button className="aa-mobile-danger-button" onClick={props.onRequestForget}><Unplug />撤销这台手机的权限</button>
      </div>
    </section>
  );
}

function ForgetDeviceDialog(props: {
  readonly client: RemoteMobileClient;
  readonly onClose: () => void;
  readonly onForgot: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useModalFocus<HTMLElement>(() => {
    if (!busy) props.onClose();
  });
  const forget = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await props.client.forgetDevice();
      props.onForgot();
    } catch (cause) {
      setError(errorMessage(cause, "无法撤销这台手机的权限"));
      setBusy(false);
    }
  };
  return (
    <div className="aa-mobile-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (!busy && event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-dialog aa-mobile-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="forget-device-title" aria-describedby="forget-device-description">
        <header><h2 id="forget-device-title">撤销手机权限</h2><IconButton label="关闭" disabled={busy} onClick={props.onClose}><X /></IconButton></header>
        <p id="forget-device-description">将断开与电脑的协同，并清除这台手机上的本地协同数据。</p>
        {error && <Notice>{error}</Notice>}
        <footer>
          <button type="button" data-modal-initial disabled={busy} onClick={props.onClose}>取消</button>
          <button type="button" className="danger" disabled={busy} onClick={() => void forget()}>{busy ? <LoaderCircle className="spin" /> : <Unplug />}撤销权限</button>
        </footer>
      </section>
    </div>
  );
}

function DetailHeader({ title, context, onBack }: { readonly title: string; readonly context?: string; readonly onBack: () => void }) {
  return (
    <header className="aa-mobile-detail-header">
      <div className="aa-mobile-detail-leading">
        <IconButton label="返回" onClick={onBack}><ArrowLeft /></IconButton>
        <div className="aa-mobile-detail-title">
          <h1>{title}</h1>
          {context !== undefined && <span><Layers />{context}</span>}
        </div>
      </div>
      <span className="aa-mobile-header-spacer" aria-hidden="true" />
    </header>
  );
}

function ConversationSection({ title, action, children }: { readonly title: string; readonly action?: ReactNode; readonly children: ReactNode }) {
  return <section className="aa-mobile-content-section"><header><h2>{title}</h2>{action}</header><div>{children}</div></section>;
}

function OwnerPickerSheet(props: {
  readonly spaces: readonly SpaceItem[];
  readonly selectedId?: string;
  readonly onClose: () => void;
  readonly onSelect: (spaceId: string) => void;
  readonly onCreateSpace: () => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>(props.onClose);
  return (
    <div className="aa-mobile-sheet-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-owner-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-owner-title" aria-describedby="mobile-owner-help">
        <header><div><p className="aa-mobile-eyebrow">新对话</p><h2 id="mobile-owner-title">选择空间</h2></div><IconButton label="关闭" onClick={props.onClose}><X /></IconButton></header>
        <p id="mobile-owner-help" className="aa-mobile-owner-help">对话创建后会固定属于所选空间，之后不能在对话中切换。</p>
        <div className="aa-mobile-owner-list" role="listbox" aria-label="可用空间" aria-orientation="vertical">
          {props.spaces.length === 0 ? <QuietEmpty icon={<Layers />} label="还没有空间" /> : props.spaces.map((space) => (
            <button type="button" role="option" aria-selected={space.id === props.selectedId} tabIndex={space.id === props.selectedId ? 0 : -1} data-active={space.id === props.selectedId || undefined} key={space.id} onKeyDown={moveListSelection} onClick={() => props.onSelect(space.id)}>
              <span className="aa-mobile-space-accent" data-tone={spaceTone(space.id)} aria-hidden="true" />
              <span><strong>{space.title}</strong></span>
              {space.id === props.selectedId && <Check />}
            </button>
          ))}
        </div>
        <button type="button" className="aa-mobile-owner-create" onClick={props.onCreateSpace}><Plus />新建空间</button>
      </section>
    </div>
  );
}

function NewSpaceDialog(props: {
  readonly client: RemoteMobileClient;
  readonly onClose: () => void;
  readonly onCreated: (spaceId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useModalFocus<HTMLFormElement>(() => {
    if (!busy) props.onClose();
  });
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const value = title.trim();
    if (value.length === 0) return;
    setBusy(true);
    setError(undefined);
    const spaceId = createClientId();
    try {
      await createSpace(props.client, spaceId, value);
      props.onCreated(spaceId);
    } catch (cause) {
      setError(errorMessage(cause, "无法创建空间"));
      setBusy(false);
    }
  };
  return (
    <div className="aa-mobile-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target && !busy) props.onClose();
    }}>
      <form ref={dialogRef} className="aa-mobile-dialog" role="dialog" aria-modal="true" aria-labelledby="new-space-title" onSubmit={(event) => void submit(event)}>
        <header><h2 id="new-space-title">新建空间</h2><IconButton label="关闭" disabled={busy} onClick={props.onClose}><X /></IconButton></header>
        <label><span>名称</span><input data-modal-initial value={title} maxLength={160} spellCheck={false} onChange={(event) => setTitle(event.target.value)} /></label>
        {error && <Notice>{error}</Notice>}
        <button type="submit" disabled={busy || title.trim().length === 0}>{busy && <LoaderCircle className="spin" />}创建</button>
      </form>
    </div>
  );
}

function ModelPicker(props: {
  readonly options: NonNullable<MobileRemoteState["modelOptions"]>;
  readonly selectedId?: string;
  readonly onClose: () => void;
  readonly onSelect: (id: string) => void;
}) {
  const dialogRef = useModalFocus<HTMLElement>(props.onClose);
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = normalizedQuery.length === 0
    ? props.options
    : props.options.filter((option) => `${option.label} ${option.providerLabel ?? ""}`.toLocaleLowerCase().includes(normalizedQuery));
  const searchEnabled = props.options.length > 12;
  return (
    <div className="aa-mobile-sheet-backdrop aa-mobile-model-picker-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.currentTarget === event.target) props.onClose();
    }}>
      <section ref={dialogRef} className="aa-mobile-model-sheet" role="dialog" aria-modal="true" aria-label="选择模型">
        <header><h2>模型</h2><IconButton label="关闭" onClick={props.onClose}><X /></IconButton></header>
        {searchEnabled && (
          <label className="aa-mobile-model-search">
            <Search aria-hidden="true" />
            <input aria-label="搜索模型" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" spellCheck={false} />
          </label>
        )}
        <div className="aa-mobile-model-list" role="listbox" aria-label="可用模型" aria-orientation="vertical">
          {props.options.length === 0
            ? <QuietEmpty icon={<Cpu />} label="电脑暂未提供可用模型" />
            : filteredOptions.length === 0
              ? <QuietEmpty icon={<Search />} label="没有匹配的模型" />
              : filteredOptions.map((option) => (
            <button
              type="button"
              key={option.id}
              role="option"
              aria-selected={option.id === props.selectedId}
              tabIndex={option.id === props.selectedId ? 0 : -1}
              data-active={option.id === props.selectedId || undefined}
              data-modal-initial={option.id === props.selectedId ? true : undefined}
              onKeyDown={moveListSelection}
              onClick={() => props.onSelect(option.id)}
            >
              <MobileModelIcon option={option} />
              <span>
                <strong>{option.label}</strong>
                <small>{modelOptionDetails(option)}</small>
              </span>
              {option.id === props.selectedId && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function MobileModelIcon(props: {
  readonly option?: MobileModelOption;
  readonly compact?: boolean;
}) {
  const icon = props.option === undefined
    ? { family: "unknown" as const }
    : resolveMobileModelIcon(props.option);
  return (
    <span className={`aa-mobile-model-icon${props.compact ? " compact" : ""}`} data-family={icon.family} aria-hidden="true">
      {icon.svg === undefined
        ? <span className="aa-mobile-model-initial">{props.option === undefined ? "M" : mobileModelInitial(props.option)}</span>
        : <span dangerouslySetInnerHTML={{ __html: icon.svg }} />}
    </span>
  );
}

function ModelSelectorButton(props: {
  readonly className: string;
  readonly labelPrefix: string;
  readonly model?: MobileModelOption;
  readonly onClick: () => void;
}) {
  const label = props.model?.label ?? "默认模型";
  return (
    <button
      type="button"
      className={props.className}
      aria-label={`${props.labelPrefix}${label}`}
      onClick={props.onClick}
    >
      <MobileModelIcon option={props.model} compact />
      <span>{label}</span>
      <ChevronDown aria-hidden="true" />
    </button>
  );
}

function modelOptionDetails(option: NonNullable<MobileRemoteState["modelOptions"]>[number]): string {
  const capabilities = [option.supportsTools ? "工具" : undefined, option.supportsVision ? "视觉" : undefined]
    .filter((value): value is string => value !== undefined);
  return [option.providerLabel, ...capabilities].filter((value): value is string => value !== undefined && value.length > 0).join(" · ") || "可用模型";
}

function moveMenuSelection(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  if (items.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(0, items.indexOf(event.currentTarget));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[nextIndex]?.focus();
}

function moveListSelection(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
  if (options.length === 0) return;
  event.preventDefault();
  const currentIndex = Math.max(0, options.indexOf(event.currentTarget));
  const nextIndex = event.key === "Home"
    ? 0
    : event.key === "End"
      ? options.length - 1
      : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
  options[nextIndex]?.focus();
}

function CompletedMarkdown({ text }: { readonly text: string }) {
  return (
    <Suspense fallback={<p className="aa-mobile-stream-text">{text}</p>}>
      <CompletedMarkdownContent text={text} />
    </Suspense>
  );
}

function QuietEmpty({ icon, label }: { readonly icon: ReactNode; readonly label: string }) {
  return <div className="aa-mobile-quiet-empty" role="status"><span aria-hidden="true">{icon}</span><span>{label}</span></div>;
}

async function createSpace(
  client: RemoteMobileClient,
  spaceId: string,
  title: string,
): Promise<void> {
  const now = new Date().toISOString();
  await client.submitVaultMutation({
    kind: "space",
    resourceId: spaceId,
    baseRevision: 0,
    operation: "upsert",
    payloadSchemaVersion: 1,
    payload: {
      title,
      createdAt: now,
      updatedAt: now,
    },
  });
}

function connectionPresentation(state: MobileRemoteState): { readonly label: string; readonly tone: string } {
  if (state.connection === "connecting") return { label: "连接中", tone: "attention" };
  if (state.connection !== "connected") return { label: "服务离线", tone: "offline" };
  if (!state.peerOnline) return { label: "电脑离线", tone: "offline" };
  return { label: "已连接", tone: "online" };
}

function attentionStatusText(status?: string): string | undefined {
  const values: Readonly<Record<string, string | undefined>> = {
    idle: undefined,
    pending: "等待发送",
    queued: "已排队",
    running: "进行中",
    awaiting_approval: "待确认",
    completed: undefined,
    failed: "失败",
    cancelled: "已取消",
    blocked: "已暂停",
  };
  return status === undefined ? undefined : values[status];
}

function conversationLifecycleText(status: string | undefined, pendingConfirmationCount: number): string | undefined {
  if (status === "awaiting_approval" && pendingConfirmationCount > 0) return undefined;
  const values: Readonly<Record<string, string | undefined>> = {
    idle: undefined,
    pending: "等待发送",
    queued: "等待开始",
    running: "正在处理",
    awaiting_approval: "等待确认",
    completed: undefined,
    failed: "本次运行失败",
    cancelled: "已停止",
    blocked: "运行已暂停",
  };
  return status === undefined ? undefined : values[status];
}

function conversationMetaText(status: string, updatedAt: string): string {
  const time = formatRelativeTime(updatedAt);
  const attention = attentionStatusText(status);
  return attention === undefined ? time : `${attention} · ${time}`;
}

function spaceTone(spaceId: string): number {
  let hash = 0;
  for (let index = 0; index < spaceId.length; index += 1) {
    hash = (hash * 31 + spaceId.charCodeAt(index)) >>> 0;
  }
  return hash % 4;
}

function spaceInitial(title: string): string {
  const value = title.trim();
  return value.length === 0 ? "·" : Array.from(value)[0] ?? "·";
}

function resizeComposer(event: FormEvent<HTMLTextAreaElement>): void {
  const field = event.currentTarget;
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, 144)}px`;
}

function useMobileTheme(): MobileTheme {
  const [systemTheme, setSystemTheme] = useState<MobileTheme>(() => preferredSystemTheme());

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", systemTheme);
  }, [systemTheme]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (): void => setSystemTheme(query.matches ? "dark" : "light");
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return systemTheme;
}

function preferredSystemTheme(): MobileTheme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function useSystemThemeColor(theme: MobileTheme): void {
  useEffect(() => {
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute("content", MOBILE_THEME_SURFACE[theme]);
  }, [theme]);
}

type ScreenProps = { readonly client: RemoteMobileClient; readonly state: MobileRemoteState };
