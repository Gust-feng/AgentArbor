import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CapacitorBarcodeScanner,
  CapacitorBarcodeScannerAndroidScanningLibrary,
  CapacitorBarcodeScannerCameraDirection,
  CapacitorBarcodeScannerScanOrientation,
  CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FolderPlus,
  FolderTree,
  History,
  Laptop,
  LibraryBig,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Smartphone,
  Unplug,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";

import { createClientId, type MobileRemoteState, type RemoteMobileClient } from "./remote-client";

type Section = "chat" | "approvals" | "library" | "account";
type LibrarySection = "spaces" | "notes";

const DEFAULT_RELAY_URL = import.meta.env.VITE_AGENTARBOR_RELAY_URL ?? "";

export function App({ client }: { readonly client: RemoteMobileClient }) {
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const [section, setSection] = useState<Section>("chat");

  useEffect(() => {
    void client.start();
    return () => client.release();
  }, [client]);

  if (state.connection === "loading") return <LoadingScreen />;
  if (state.connection === "unpaired" || state.connection === "pairing") {
    return <PairingScreen client={client} state={state} />;
  }

  const pendingApprovals = state.runs
    .filter((run) => run.status === "awaiting_approval")
    .reduce((count, run) => count + run.pendingConfirmations.length, 0);
  const latestCommandError = state.commandResults.find((result) => result.status !== "applied")?.error;

  return (
    <div className="mobile-shell">
      <Header state={state} />
      <main className="mobile-main">
        {(state.error ?? latestCommandError?.message) && (
          <Notice tone="danger">{state.error ?? latestCommandError?.message}</Notice>
        )}
        {section === "chat" && <ChatScreen client={client} state={state} />}
        {section === "approvals" && <ApprovalsScreen client={client} state={state} />}
        {section === "library" && <LibraryScreen client={client} state={state} />}
        {section === "account" && <AccountScreen client={client} state={state} />}
      </main>
      <nav className="bottom-nav" aria-label="主要功能">
        <NavButton active={section === "chat"} label="对话" icon={<MessageCircle />} onClick={() => setSection("chat")} />
        <NavButton
          active={section === "approvals"}
          label="确认"
          icon={<ShieldCheck />}
          badge={pendingApprovals}
          onClick={() => setSection("approvals")}
        />
        <NavButton active={section === "library"} label="资料" icon={<LibraryBig />} onClick={() => setSection("library")} />
        <NavButton active={section === "account"} label="我的" icon={<UserRound />} onClick={() => setSection("account")} />
      </nav>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="center-screen" role="status">
      <Brand />
      <LoaderCircle className="spin" />
    </div>
  );
}

function PairingScreen({ client, state }: ScreenProps) {
  const [relayUrl, setRelayUrl] = useState(() =>
    (globalThis as typeof globalThis & { __AGENTARBOR_RELAY_URL__?: string }).__AGENTARBOR_RELAY_URL__
      ?? DEFAULT_RELAY_URL);
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("我的手机");
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
      await client.joinPairing(relayUrl, code, deviceName.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法加入配对");
    } finally {
      setBusy(false);
    }
  };

  const scanPairingCode = async () => {
    setError(undefined);
    try {
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
      setError(cause instanceof Error ? cause.message : "无法扫描配对二维码");
    }
  };

  if (pairing !== undefined) {
    const unavailable = pairing.status === "expired" || pairing.status === "rejected";
    return (
      <div className="pairing-page">
        <Brand />
        <main className="pairing-main">
          <div className="pairing-devices" aria-hidden="true">
            <Smartphone />
            <span />
            <Laptop />
          </div>
          <p className="eyebrow">{unavailable ? "配对未完成" : "等待电脑批准"}</p>
          <h1>{pairing.peerDeviceName ?? "电脑端"}</h1>
          <div className="pairing-code" aria-label={`配对码 ${pairing.pairingCode}`}>
            <span>{pairing.pairingCode.slice(0, 3)}</span>
            <i />
            <span>{pairing.pairingCode.slice(3)}</span>
          </div>
          {unavailable ? (
            <>
              <Notice tone="danger">{pairing.status === "expired" ? "配对码已过期" : "电脑拒绝了此次连接"}</Notice>
              <button className="primary-button" onClick={() => void client.forgetDevice()}>重新配对</button>
            </>
          ) : (
            <div className="pairing-waiting" role="status">
              <LoaderCircle className="spin" />
              <span>请在电脑端批准连接</span>
            </div>
          )}
          <button className="text-button" disabled={unavailable} onClick={() => void client.inspectPairing()}>
            <RefreshCw />刷新
          </button>
          {error && <Notice tone="danger">{error}</Notice>}
        </main>
      </div>
    );
  }

  return (
    <div className="pairing-page">
      <Brand />
      <main className="pairing-main pairing-entry">
        <p className="eyebrow">移动协同</p>
        <h1>连接电脑</h1>
        <form className="stack-form" onSubmit={submit}>
          <label className="field-label" htmlFor="pairing-code">配对码</label>
          <input
            id="pairing-code"
            className="code-input"
            value={code}
            autoComplete="one-time-code"
            autoFocus
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
            onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
          />
          <button type="button" className="scan-button" onClick={() => void scanPairingCode()}><ScanLine />扫描二维码</button>
          <button className="primary-button" disabled={busy || code.length !== 6 || deviceName.trim().length === 0}>
            {busy ? <LoaderCircle className="spin" /> : <ChevronRight />}
            继续
          </button>
          <details className="pairing-options">
            <summary>连接选项</summary>
            <div className="pairing-option-fields">
              <label>设备名称<input value={deviceName} maxLength={160} onChange={(event) => setDeviceName(event.target.value)} /></label>
              <label>中继地址<input value={relayUrl} inputMode="url" onChange={(event) => setRelayUrl(event.target.value)} /></label>
            </div>
          </details>
        </form>
        {error && <Notice tone="danger">{error}</Notice>}
      </main>
    </div>
  );
}

function Header({ state }: { readonly state: MobileRemoteState }) {
  const connection = connectionPresentation(state);
  return (
    <header className="mobile-header">
      <Brand compact />
      <div className={`connection-state ${connection.tone}`} title={state.error} role="status">
        <span className="connection-dot" />
        {connection.label}
      </div>
    </header>
  );
}

function ChatScreen({ client, state }: ScreenProps) {
  const [selectedId, setSelectedId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sendError, setSendError] = useState<string>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const initializedSelection = useRef(false);
  const requestedVersions = useRef(new Map<string, string>());
  const selected = state.conversations.find((conversation) => conversation.conversationId === selectedId);
  const page = selectedId === undefined ? undefined : state.conversationPages[selectedId];
  const activeRun = state.runs.find((run) => run.runId === selected?.activeRunId);

  useEffect(() => {
    if (initializedSelection.current || state.conversations.length === 0) return;
    initializedSelection.current = true;
    setSelectedId(state.conversations[0].conversationId);
  }, [state.conversations]);

  useEffect(() => {
    if (selected === undefined || !state.peerOnline) return;
    if (requestedVersions.current.get(selected.conversationId) === selected.updatedAt) return;
    requestedVersions.current.set(selected.conversationId, selected.updatedAt);
    void client.requestConversationPage(selected.conversationId).catch(() => {
      requestedVersions.current.delete(selected.conversationId);
    });
  }, [client, selected?.conversationId, selected?.updatedAt, state.peerOnline]);

  const selectConversation = (conversationId?: string) => {
    initializedSelection.current = true;
    setSelectedId(conversationId);
    setHistoryOpen(false);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (content.length === 0) return;
    setSendError(undefined);
    setMessage("");
    try {
      await client.sendCommand({
        kind: "conversation.submit",
        ...(selectedId === undefined ? {} : { conversationId: selectedId }),
        message: content,
      });
    } catch (cause) {
      setMessage(content);
      setSendError(cause instanceof Error ? cause.message : "消息未能保存");
    }
  };

  const loadEarlier = async () => {
    if (selectedId === undefined || page?.nextBeforeTurnId === undefined) return;
    setLoadingEarlier(true);
    try {
      await client.requestConversationPage(selectedId, page.nextBeforeTurnId);
    } finally {
      setLoadingEarlier(false);
    }
  };

  const liveText = activeRun?.visibleAssistantText?.trim() ?? "";
  const liveTurnExists = page?.turns.some((turn) => turn.role === "assistant" && turn.runId === activeRun?.runId) ?? false;

  return (
    <section className="screen-section chat-screen">
      <div className="chat-toolbar">
        <button className="conversation-title-button" onClick={() => setHistoryOpen(true)}>
          <span>{selected?.title ?? "新对话"}</span>
          <ChevronDown />
        </button>
        <button className="icon-button" aria-label="新对话" onClick={() => selectConversation(undefined)}><Plus /></button>
      </div>

      <div className="transcript" aria-live="polite">
        {selected === undefined ? (
          <EmptyState icon={<MessageCircle />} title="新对话" />
        ) : page === undefined ? (
          state.peerOnline
            ? <EmptyState icon={<LoaderCircle className="spin" />} title="正在获取对话" />
            : <EmptyState icon={<WifiOff />} title="电脑离线" detail="此对话尚未缓存在手机" />
        ) : (
          <>
            {page.hasMore && (
              <button className="load-earlier" disabled={loadingEarlier || !state.peerOnline} onClick={() => void loadEarlier()}>
                {loadingEarlier ? <LoaderCircle className="spin" /> : <History />}
                更早内容
              </button>
            )}
            {page.turns.map((turn) => {
              const streamed = turn.role === "assistant" && turn.runId === activeRun?.runId && liveText.length > 0;
              return (
                <article className={`message ${turn.role}`} key={turn.turnId}>
                  {turn.role === "assistant" && (
                    <div className="message-meta">
                      <span>AgentArbor</span>
                      {attentionStatusText(turn.status) && <em>{attentionStatusText(turn.status)}</em>}
                    </div>
                  )}
                  <p>{streamed ? liveText : turn.content || "正在思考…"}</p>
                  {turn.role === "user" && attentionStatusText(turn.status) && (
                    <small className="turn-status">{attentionStatusText(turn.status)}</small>
                  )}
                </article>
              );
            })}
            {!liveTurnExists && liveText.length > 0 && (
              <article className="message assistant live-message">
                <div className="message-meta"><span>AgentArbor</span><em>{attentionStatusText(activeRun?.status)}</em></div>
                <p>{liveText}</p>
              </article>
            )}
          </>
        )}
      </div>

      {state.pendingCommandIds.length > 0 && (
        <p className="pending-line"><LoaderCircle className="spin" />{state.pendingCommandIds.length} 条待发送</p>
      )}
      {sendError && <p className="composer-error">{sendError}</p>}
      <form className="composer" onSubmit={send}>
        <textarea
          value={message}
          rows={1}
          aria-label="消息"
          placeholder={state.peerOnline ? "输入消息" : "离线消息将在电脑上线后发送"}
          onInput={resizeComposer}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button aria-label="发送" disabled={message.trim().length === 0}><ArrowUp /></button>
      </form>

      {historyOpen && (
        <ConversationSheet
          conversations={state.conversations}
          selectedId={selectedId}
          onClose={() => setHistoryOpen(false)}
          onSelect={selectConversation}
        />
      )}
    </section>
  );
}

function ConversationSheet({ conversations, selectedId, onClose, onSelect }: {
  readonly conversations: MobileRemoteState["conversations"];
  readonly selectedId?: string;
  readonly onClose: () => void;
  readonly onSelect: (conversationId?: string) => void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="conversation-sheet" role="dialog" aria-modal="true" aria-label="对话">
        <div className="sheet-header">
          <strong>对话</strong>
          <button className="icon-button bare" aria-label="关闭" onClick={onClose}><X /></button>
        </div>
        <div className="conversation-list">
          <button className={`conversation-row new ${selectedId === undefined ? "active" : ""}`} onClick={() => onSelect(undefined)}>
            <span className="conversation-row-icon"><Plus /></span>
            <strong>新对话</strong>
          </button>
          {conversations.map((conversation) => (
            <button
              className={`conversation-row ${conversation.conversationId === selectedId ? "active" : ""}`}
              key={conversation.conversationId}
              onClick={() => onSelect(conversation.conversationId)}
            >
              <span className={`conversation-status ${statusTone(conversation.status)}`} />
              <span className="conversation-copy">
                <strong>{conversation.title || "未命名对话"}</strong>
                <small>{formatRelativeTime(conversation.updatedAt)}{attentionStatusText(conversation.status) ? ` · ${attentionStatusText(conversation.status)}` : ""}</small>
              </span>
              <ChevronRight />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ApprovalsScreen({ client, state }: ScreenProps) {
  const pending = state.runs.flatMap((run) =>
    run.pendingConfirmations.map((confirmation) => ({ run, confirmation })));
  const [guidanceFor, setGuidanceFor] = useState<string>();
  const [guidance, setGuidance] = useState("");

  const decide = async (runId: string, confirmationId: string, decision: "approve_once" | "deny") => {
    await client.sendCommand({ kind: "confirmation.decide", runId, confirmationId, decision });
  };

  const sendGuidance = async (runId: string, confirmationId: string) => {
    const content = guidance.trim();
    if (content.length === 0) return;
    await client.sendCommand({
      kind: "confirmation.decide",
      runId,
      confirmationId,
      decision: "guidance",
      guidance: content,
    });
    setGuidance("");
    setGuidanceFor(undefined);
  };

  return (
    <section className="screen-section">
      <ScreenHeading eyebrow="电脑请求" title={pending.length === 0 ? "待确认" : `待确认 ${pending.length}`} />
      {pending.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title="暂无待确认" />
      ) : (
        <div className="approval-list">
          {pending.map(({ run, confirmation }) => {
            const conversation = state.conversations.find((item) => item.conversationId === run.conversationId);
            return (
              <article className={`approval-item ${confirmation.riskLevel}`} key={confirmation.confirmationId}>
                <div className="approval-context">
                  <span>{conversation?.title ?? "当前对话"}</span>
                  <span className={`risk-label ${confirmation.riskLevel}`}>{riskText(confirmation.riskLevel)}</span>
                </div>
                <h2>{confirmation.title}</h2>
                <p className="action-summary">{confirmation.actionSummary}</p>
                {confirmation.consequence && <p className="consequence"><CircleAlert />{confirmation.consequence}</p>}
                {confirmation.affectedResources.length > 0 && (
                  <details className="evidence-details">
                    <summary>命令与影响范围</summary>
                    <ul>{confirmation.affectedResources.map((resource) => <li key={resource}><code>{resource}</code></li>)}</ul>
                  </details>
                )}
                {guidanceFor === confirmation.confirmationId && (
                  <div className="guidance-box">
                    <textarea autoFocus value={guidance} placeholder="补充要求" onChange={(event) => setGuidance(event.target.value)} />
                    <div>
                      <button className="text-button" onClick={() => setGuidanceFor(undefined)}>取消</button>
                      <button className="small-primary" disabled={!guidance.trim()} onClick={() => void sendGuidance(run.runId, confirmation.confirmationId)}>发送</button>
                    </div>
                  </div>
                )}
                <div className="approval-actions">
                  <button className="deny" onClick={() => void decide(run.runId, confirmation.confirmationId, "deny")}><X />拒绝</button>
                  <button onClick={() => setGuidanceFor(confirmation.confirmationId)}>调整</button>
                  <button className="approve" onClick={() => void decide(run.runId, confirmation.confirmationId, "approve_once")}><Check />批准一次</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LibraryScreen({ client, state }: ScreenProps) {
  const [activeSection, setActiveSection] = useState<LibrarySection>("spaces");
  return (
    <section className="screen-section">
      <ScreenHeading eyebrow="同步资料" title="资料" />
      <div className="segmented-control" role="tablist" aria-label="资料类型">
        <button role="tab" aria-selected={activeSection === "spaces"} className={activeSection === "spaces" ? "active" : ""} onClick={() => setActiveSection("spaces")}>
          <FolderTree />Space
        </button>
        <button role="tab" aria-selected={activeSection === "notes"} className={activeSection === "notes" ? "active" : ""} onClick={() => setActiveSection("notes")}>
          <NotebookPen />笔记
        </button>
      </div>
      {activeSection === "spaces"
        ? <SpacesScreen client={client} state={state} />
        : <NotesScreen client={client} state={state} />}
    </section>
  );
}

function SpacesScreen({ client, state }: ScreenProps) {
  const [creating, setCreating] = useState(false);
  const [spaceTitle, setSpaceTitle] = useState("");
  const [editingFile, setEditingFile] = useState<{ referenceId: string; relativePath: string; text: string; fingerprint: string }>();
  const [newFileFor, setNewFileFor] = useState<string>();
  const [newFileName, setNewFileName] = useState("note.md");
  const [newFileText, setNewFileText] = useState("");

  const createSpace = async (event: FormEvent) => {
    event.preventDefault();
    if (!spaceTitle.trim()) return;
    await client.sendCommand({ kind: "space.create", spaceId: createClientId(), title: spaceTitle.trim() });
    setSpaceTitle("");
    setCreating(false);
  };

  return (
    <div className="library-pane" role="tabpanel">
      <div className="section-command-bar">
        <span>{state.spaces.length} 个 Space</span>
        <button className="small-button" onClick={() => setCreating((value) => !value)}><Plus />新建</button>
      </div>
      {creating && (
        <form className="inline-create" onSubmit={createSpace}>
          <input autoFocus value={spaceTitle} placeholder="Space 名称" onChange={(event) => setSpaceTitle(event.target.value)} />
          <button disabled={!spaceTitle.trim()}>创建</button>
        </form>
      )}
      {state.spaces.length === 0 ? (
        <EmptyState icon={<FolderTree />} title="暂无 Space" />
      ) : (
        <div className="space-list">
          {state.spaces.map((space) => {
            const folders = state.managedFolders.filter((folder) => folder.spaceId === space.id);
            return (
              <section className="space-group" key={space.id}>
                <div className="space-heading">
                  <div><h2>{space.title}</h2><p>{space.references.length} 个引用</p></div>
                  <button className="small-button quiet" onClick={() => void client.sendCommand({
                    kind: "space.reference.add",
                    referenceId: createClientId(),
                    spaceId: space.id,
                    title: "软件文件夹",
                    reference: { kind: "managed_folder" },
                  })}><FolderPlus />文件夹</button>
                </div>
                {folders.length === 0 && <p className="empty-row">暂无软件文件夹</p>}
                {folders.map((folder) => (
                  <div className="folder-block" key={folder.referenceId}>
                    <div className="folder-heading">
                      <strong>{folder.title}</strong>
                      <button className="text-button compact" onClick={() => setNewFileFor(folder.referenceId)}><FilePlus2 />新建文件</button>
                    </div>
                    {newFileFor === folder.referenceId && (
                      <form className="new-file-form" onSubmit={(event) => {
                        event.preventDefault();
                        void client.sendCommand({
                          kind: "managed_file.create_text",
                          referenceId: folder.referenceId,
                          relativePath: newFileName,
                          text: newFileText,
                        });
                        setNewFileFor(undefined);
                        setNewFileText("");
                      }}>
                        <input value={newFileName} aria-label="文件名" onChange={(event) => setNewFileName(event.target.value)} />
                        <textarea value={newFileText} placeholder="文件内容" onChange={(event) => setNewFileText(event.target.value)} />
                        <div>
                          <button type="button" className="text-button" onClick={() => setNewFileFor(undefined)}>取消</button>
                          <button disabled={!newFileName.trim()}>保存</button>
                        </div>
                      </form>
                    )}
                    {folder.files.length === 0 ? (
                      <p className="empty-row compact">文件夹为空</p>
                    ) : folder.files.map((file) => (
                      <button className="file-row" key={file.relativePath} onClick={() => setEditingFile({ referenceId: folder.referenceId, ...file })}>
                        <span>{file.relativePath}</span><ChevronRight />
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
      {editingFile && (
        <EditorSheet
          title={editingFile.relativePath}
          value={editingFile.text}
          onClose={() => setEditingFile(undefined)}
          onSave={(text) => {
            void client.sendCommand({
              kind: "managed_file.replace_text",
              referenceId: editingFile.referenceId,
              relativePath: editingFile.relativePath,
              expectedFingerprint: editingFile.fingerprint,
              text,
            });
            setEditingFile(undefined);
          }}
        />
      )}
    </div>
  );
}

function NotesScreen({ client, state }: ScreenProps) {
  const [editingNote, setEditingNote] = useState<(typeof state.notebooks)[number]>();
  const [editingAsset, setEditingAsset] = useState<(typeof state.assets)[number]>();
  const items = state.notebooks.length + state.assets.length;

  return (
    <div className="library-pane" role="tabpanel">
      <div className="section-command-bar"><span>{items} 项内容</span></div>
      {items === 0 ? (
        <EmptyState icon={<NotebookPen />} title="暂无笔记或资产" />
      ) : (
        <div className="settings-list">
          {state.notebooks.map((notebook) => (
            <button className="settings-row" key={notebook.notebookId} onClick={() => setEditingNote(notebook)}>
              <span className="row-leading-icon"><NotebookPen /></span>
              <span className="settings-copy"><strong>{notebook.label}</strong><small>{notebook.scope === "global" ? "全局笔记" : "工作区笔记"} · {notebook.content.length} 字</small></span>
              <ChevronRight />
            </button>
          ))}
          {state.assets.map((asset) => (
            <button className="settings-row" key={asset.assetId} onClick={() => setEditingAsset(asset)}>
              <span className="row-leading-icon"><FilePlus2 /></span>
              <span className="settings-copy"><strong>{asset.title}</strong><small>{asset.kind === "markdown" ? "Markdown" : asset.language}</small></span>
              <ChevronRight />
            </button>
          ))}
        </div>
      )}
      {editingNote && (
        <EditorSheet
          title={editingNote.label}
          value={editingNote.content}
          onClose={() => setEditingNote(undefined)}
          onSave={(content) => {
            void client.sendCommand({ kind: "note.replace", notebookId: editingNote.notebookId, expectedVersion: editingNote.version, content });
            setEditingNote(undefined);
          }}
        />
      )}
      {editingAsset && (
        <EditorSheet
          title={editingAsset.title}
          value={editingAsset.text}
          onClose={() => setEditingAsset(undefined)}
          onSave={(text) => {
            void client.sendCommand({ kind: "asset.replace_text", assetId: editingAsset.assetId, expectedFingerprint: editingAsset.fingerprint, text });
            setEditingAsset(undefined);
          }}
        />
      )}
    </div>
  );
}

function AccountScreen({ client, state }: ScreenProps) {
  const binding = state.binding;
  const connection = connectionPresentation(state);
  return (
    <section className="screen-section account-screen">
      <ScreenHeading eyebrow="账户与设备" title="我的" />
      <div className="profile-summary">
        <span className="profile-avatar">{(binding?.displayName ?? "A").slice(0, 1).toUpperCase()}</span>
        <div><strong>{binding?.displayName ?? "AgentArbor 用户"}</strong><span>@{binding?.accountHandle ?? "unknown"}</span></div>
      </div>

      <section className="account-group">
        <h2>设备</h2>
        <div className="device-row">
          <span className="device-icon"><Laptop /></span>
          <span className="device-copy"><strong>{binding?.peerDeviceName ?? "已配对电脑"}</strong><small>{connection.label}</small></span>
          <span className={`device-presence ${connection.tone}`} />
        </div>
        <div className="device-row">
          <span className="device-icon"><Smartphone /></span>
          <span className="device-copy"><strong>当前手机</strong><small>已授权</small></span>
          <ShieldCheck />
        </div>
      </section>

      <details className="connection-details">
        <summary>连接信息</summary>
        <dl>
          <div><dt>中继</dt><dd>{binding?.relayUrl ?? "-"}</dd></div>
          <div><dt>账户 ID</dt><dd>{binding?.accountId ?? "-"}</dd></div>
        </dl>
      </details>

      <button className="danger-button" onClick={() => {
        if (window.confirm("忘记这台电脑并清除手机上的协同数据？")) void client.forgetDevice();
      }}><Unplug />忘记这台电脑</button>
    </section>
  );
}

function EditorSheet({ title, value, onClose, onSave }: {
  readonly title: string;
  readonly value: string;
  readonly onClose: () => void;
  readonly onSave: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  return (
    <div className="sheet-backdrop editor-backdrop">
      <section className="editor-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="editor-header">
          <button className="text-button" onClick={onClose}>取消</button>
          <strong>{title}</strong>
          <button className="text-button accent" onClick={() => onSave(text)}>保存</button>
        </div>
        <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} />
      </section>
    </div>
  );
}

function ScreenHeading({ eyebrow, title }: { readonly eyebrow: string; readonly title: string }) {
  return <div className="screen-heading"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div>;
}

function Brand({ compact = false }: { readonly compact?: boolean }) {
  return <div className={`brand ${compact ? "compact" : ""}`}><img src="/favicon.svg" alt="" /><span>AgentArbor</span></div>;
}

function Notice({ children, tone }: { readonly children: ReactNode; readonly tone: "danger" }) {
  return <div className={`notice ${tone}`} role="alert"><CircleAlert />{children}</div>;
}

function EmptyState({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail?: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}

function NavButton({ active, label, icon, badge, onClick }: {
  readonly active: boolean;
  readonly label: string;
  readonly icon: ReactNode;
  readonly badge?: number;
  readonly onClick: () => void;
}) {
  return (
    <button className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={onClick}>
      <span className="nav-icon">{icon}{badge ? <b>{badge > 99 ? "99+" : badge}</b> : null}</span>
      <span>{label}</span>
    </button>
  );
}

function connectionPresentation(state: MobileRemoteState): { readonly label: string; readonly tone: string } {
  if (state.connection === "connecting") return { label: "连接中", tone: "attention" };
  if (state.connection !== "connected") return { label: "中继离线", tone: "offline" };
  if (!state.peerOnline) return { label: "电脑离线", tone: "offline" };
  return { label: "电脑在线", tone: "online" };
}

function attentionStatusText(status?: string): string | undefined {
  const values: Record<string, string | undefined> = {
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
  return status === undefined ? undefined : values[status] ?? status;
}

function statusTone(status: string): string {
  if (status === "running" || status === "queued") return "active";
  if (status === "awaiting_approval" || status === "blocked") return "attention";
  if (status === "failed") return "danger";
  return "quiet";
}

function riskText(risk: string): string {
  return risk === "high" ? "高风险" : risk === "medium" ? "需留意" : "低风险";
}

function formatRelativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const elapsed = Date.now() - time;
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(time);
}

function resizeComposer(event: FormEvent<HTMLTextAreaElement>): void {
  const field = event.currentTarget;
  field.style.height = "auto";
  field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
}

type ScreenProps = { readonly client: RemoteMobileClient; readonly state: MobileRemoteState };
