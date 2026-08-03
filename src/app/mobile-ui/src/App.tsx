import { useEffect, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import {
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Laptop,
  LoaderCircle,
  MessageCircle,
  NotebookPen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Unplug,
  X,
} from "lucide-react";

import { createClientId, type RemoteMobileClient, type MobileRemoteState } from "./remote-client";

type Section = "chat" | "approvals" | "spaces" | "notes";

export function App({ client }: { readonly client: RemoteMobileClient }) {
  const state = useSyncExternalStore(client.subscribe, client.snapshot);
  const [section, setSection] = useState<Section>("chat");
  useEffect(() => { void client.start(); return () => client.release(); }, [client]);

  if (state.connection === "loading") return <LoadingScreen />;
  if (state.connection === "unpaired" || state.connection === "pairing") {
    return <PairingScreen client={client} state={state} />;
  }
  const pendingApprovals = state.runs.filter((run) => run.status === "awaiting_approval")
    .reduce((count, run) => count + run.pendingConfirmations.length, 0);
  return (
    <div className="mobile-shell">
      <Header state={state} />
      <main className="mobile-main">
        {state.error && <Notice tone="danger">{state.error}</Notice>}
        {state.commandResults[0]?.status !== "applied" && state.commandResults[0]?.error && (
          <Notice tone="danger">{state.commandResults[0].error.message}</Notice>
        )}
        {section === "chat" && <ChatScreen client={client} state={state} />}
        {section === "approvals" && <ApprovalsScreen client={client} state={state} />}
        {section === "spaces" && <SpacesScreen client={client} state={state} />}
        {section === "notes" && <NotesScreen client={client} state={state} />}
      </main>
      <nav className="bottom-nav" aria-label="主要功能">
        <NavButton active={section === "chat"} label="对话" icon={<MessageCircle />} onClick={() => setSection("chat")} />
        <NavButton
          active={section === "approvals"}
          label="待确认"
          icon={<ShieldCheck />}
          badge={pendingApprovals}
          onClick={() => setSection("approvals")}
        />
        <NavButton active={section === "spaces"} label="Space" icon={<FolderTree />} onClick={() => setSection("spaces")} />
        <NavButton active={section === "notes"} label="笔记" icon={<NotebookPen />} onClick={() => setSection("notes")} />
      </nav>
    </div>
  );
}

function LoadingScreen() {
  return <div className="center-screen"><LoaderCircle className="spin" /><p>正在恢复协同状态…</p></div>;
}

function PairingScreen({ client, state }: { readonly client: RemoteMobileClient; readonly state: MobileRemoteState }) {
  const [relayUrl, setRelayUrl] = useState(() =>
    (globalThis as typeof globalThis & { __AGENTARBOR_RELAY_URL__?: string }).__AGENTARBOR_RELAY_URL__
      ?? window.location.origin);
  const [code, setCode] = useState("");
  const [deviceName, setDeviceName] = useState("我的手机");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pairing = state.pairing;

  useEffect(() => {
    if (pairing === undefined) return;
    const timer = window.setInterval(() => void client.inspectPairing().catch(() => undefined), 2_000);
    return () => window.clearInterval(timer);
  }, [client, pairing?.pairingId]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try { await client.joinPairing(relayUrl, code, deviceName); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法加入配对"); }
    finally { setBusy(false); }
  };

  if (pairing !== undefined) {
    return (
      <div className="pairing-page">
        <Brand />
        <section className="pairing-panel">
          <div className="pairing-symbol"><Smartphone /><span /><Laptop /></div>
          <p className="eyebrow">核对配对码</p>
          <h1 className="pairing-code">{pairing.pairingCode.slice(0, 3)} {pairing.pairingCode.slice(3)}</h1>
          <p className="muted">确认电脑上显示的是同一个号码。配对完成后，两台设备将作为同一个用户互相信任。</p>
          <div className="pairing-peer">
            <span>{pairing.peerDeviceName ?? "正在等待电脑加入…"}</span>
            <span className={`status-pill ${pairing.peerConfirmed ? "ok" : ""}`}>
              {pairing.peerConfirmed ? "电脑已确认" : "等待电脑确认"}
            </span>
          </div>
          <button className="primary-button" disabled={busy || pairing.localConfirmed} onClick={() => {
            setBusy(true);
            void client.confirmPairing().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "确认失败"))
              .finally(() => setBusy(false));
          }}>
            {pairing.localConfirmed ? <><Check />手机已确认</> : <><ShieldCheck />号码一致，确认配对</>}
          </button>
          <button className="text-button" onClick={() => void client.inspectPairing()}><RefreshCw />刷新状态</button>
          {error && <Notice tone="danger">{error}</Notice>}
        </section>
      </div>
    );
  }

  return (
    <div className="pairing-page">
      <Brand />
      <section className="pairing-panel">
        <p className="eyebrow">AgentArbor 移动协同</p>
        <h1>连接你的电脑</h1>
        <p className="muted">在电脑端创建配对后，输入六位号码。外部工作区和磁盘文件不会同步。</p>
        <form className="stack-form" onSubmit={submit}>
          <label>中继地址<input value={relayUrl} inputMode="url" onChange={(event) => setRelayUrl(event.target.value)} /></label>
          <label>配对码<input className="code-input" value={code} inputMode="numeric" maxLength={6} placeholder="000000" onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))} /></label>
          <label>设备名称<input value={deviceName} maxLength={160} onChange={(event) => setDeviceName(event.target.value)} /></label>
          <button className="primary-button" disabled={busy || code.length !== 6}>
            {busy ? <LoaderCircle className="spin" /> : <ChevronRight />}继续
          </button>
        </form>
        {error && <Notice tone="danger">{error}</Notice>}
      </section>
    </div>
  );
}

function Header({ state }: { readonly state: MobileRemoteState }) {
  const label = state.connection === "connecting"
    ? "正在连接"
    : state.connection !== "connected"
      ? "中继离线"
      : state.peerOnline
        ? "电脑在线"
        : "电脑离线";
  const indicator = state.connection === "connected" && state.peerOnline ? "connected" : state.connection;
  return (
    <header className="mobile-header">
      <Brand compact />
      <div className="connection-state" title={state.error}>
        <span className={`connection-dot ${indicator}`} />
        {label}
      </div>
    </header>
  );
}

function ChatScreen({ client, state }: ScreenProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(state.conversations[0]?.conversationId);
  const [message, setMessage] = useState("");
  const selected = state.conversations.find((conversation) => conversation.conversationId === selectedId);
  const activeRun = state.runs.find((run) => run.runId === selected?.activeRunId);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const content = message.trim();
    if (content.length === 0) return;
    setMessage("");
    await client.sendCommand({
      kind: "conversation.submit",
      ...(selectedId === undefined ? {} : { conversationId: selectedId }),
      message: content,
    });
  };
  return (
    <section className="screen-section chat-screen">
      <div className="screen-heading row-between">
        <div><p className="eyebrow">远程继续</p><h1>{selected?.title ?? "新对话"}</h1></div>
        <button className="icon-button" aria-label="新对话" onClick={() => setSelectedId(undefined)}><Plus /></button>
      </div>
      {state.conversations.length > 0 && (
        <div className="conversation-strip" aria-label="已共享对话">
          {state.conversations.map((conversation) => (
            <button className={conversation.conversationId === selectedId ? "active" : ""} key={conversation.conversationId} onClick={() => setSelectedId(conversation.conversationId)}>
              {conversation.title}
            </button>
          ))}
        </div>
      )}
      <div className="transcript">
        {selected === undefined ? (
          <EmptyState icon={<MessageCircle />} title="从手机开始一段对话" detail="消息由电脑上的 Agent 执行；电脑离线时，消息保存在这台手机。" />
        ) : selected.turns.map((turn) => (
          <article className={`message ${turn.role}`} key={turn.turnId}>
            <div className="message-meta">{turn.role === "user" ? "你" : "AgentArbor"}<span>{statusText(turn.status)}</span></div>
            <p>{turn.role === "assistant" && turn.runId === activeRun?.runId
              ? activeRun.visibleAssistantText || turn.content || "正在思考…"
              : turn.content || (turn.role === "assistant" ? "正在思考…" : "")}</p>
          </article>
        ))}
      </div>
      {state.pendingCommandIds.length > 0 && <p className="pending-line"><LoaderCircle className="spin" />{state.pendingCommandIds.length} 条操作等待电脑确认接收</p>}
      <form className="composer" onSubmit={send}>
        <textarea value={message} rows={1} placeholder={state.peerOnline ? "发送消息给电脑上的 Agent…" : "消息将保存在本机，电脑上线后发送…"} onChange={(event) => setMessage(event.target.value)} />
        <button aria-label="发送" disabled={message.trim().length === 0}><ArrowUp /></button>
      </form>
    </section>
  );
}

function ApprovalsScreen({ client, state }: ScreenProps) {
  const pending = state.runs.flatMap((run) => run.pendingConfirmations.map((confirmation) => ({ run, confirmation })));
  const [guidanceFor, setGuidanceFor] = useState<string>();
  const [guidance, setGuidance] = useState("");
  return (
    <section className="screen-section">
      <div className="screen-heading"><p className="eyebrow">需要你的判断</p><h1>待确认</h1></div>
      {pending.length === 0 ? <EmptyState icon={<ShieldCheck />} title="没有待确认动作" detail="电脑请求执行命令或修改资源时，会出现在这里。" /> : (
        <div className="approval-list">{pending.map(({ run, confirmation }) => (
          <article className="approval-item" key={confirmation.confirmationId}>
            <div className={`risk-mark ${confirmation.riskLevel}`}><CircleAlert /></div>
            <div className="approval-body">
              <div className="row-between"><h2>{confirmation.title}</h2><span className={`risk-label ${confirmation.riskLevel}`}>{riskText(confirmation.riskLevel)}</span></div>
              <p>{confirmation.actionSummary}</p>
              {confirmation.consequence && <p className="consequence">{confirmation.consequence}</p>}
              {confirmation.affectedResources.length > 0 && <details><summary>查看命令与影响资源</summary><ul>{confirmation.affectedResources.map((resource) => <li key={resource}><code>{resource}</code></li>)}</ul></details>}
              {guidanceFor === confirmation.confirmationId && (
                <div className="guidance-box"><textarea value={guidance} placeholder="告诉 Agent 应该如何调整…" onChange={(event) => setGuidance(event.target.value)} /><button disabled={!guidance.trim()} onClick={() => void client.sendCommand({ kind: "confirmation.decide", runId: run.runId, confirmationId: confirmation.confirmationId, decision: "guidance", guidance: guidance.trim() })}>发送要求</button></div>
              )}
              <div className="approval-actions">
                <button className="deny" onClick={() => void client.sendCommand({ kind: "confirmation.decide", runId: run.runId, confirmationId: confirmation.confirmationId, decision: "deny" })}><X />拒绝</button>
                <button onClick={() => setGuidanceFor(confirmation.confirmationId)}>补充要求</button>
                <button className="approve" onClick={() => void client.sendCommand({ kind: "confirmation.decide", runId: run.runId, confirmationId: confirmation.confirmationId, decision: "approve_once" })}><Check />批准一次</button>
              </div>
            </div>
          </article>
        ))}</div>
      )}
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
    <section className="screen-section">
      <div className="screen-heading row-between"><div><p className="eyebrow">软件自有内容</p><h1>Space</h1></div><button className="icon-button" aria-label="创建 Space" onClick={() => setCreating(true)}><Plus /></button></div>
      {creating && <form className="inline-create" onSubmit={createSpace}><input autoFocus value={spaceTitle} placeholder="Space 名称" onChange={(event) => setSpaceTitle(event.target.value)} /><button>创建</button></form>}
      {state.spaces.length === 0 ? <EmptyState icon={<FolderTree />} title="还没有 Space" detail="手机可以创建 Space；只同步软件创建的文件夹和内容。" /> : (
        <div className="space-list">{state.spaces.map((space) => {
          const folders = state.managedFolders.filter((folder) => folder.spaceId === space.id);
          return <article className="space-item" key={space.id}>
            <div className="row-between"><div><h2>{space.title}</h2><p>{space.references.length} 个同步引用</p></div><button className="small-button" onClick={() => void client.sendCommand({ kind: "space.reference.add", referenceId: createClientId(), spaceId: space.id, title: "软件文件夹", reference: { kind: "managed_folder" } })}><FolderPlus />文件夹</button></div>
            {folders.map((folder) => <div className="folder-block" key={folder.referenceId}>
              <div className="row-between"><strong>{folder.title}</strong><button className="text-button compact" onClick={() => setNewFileFor(folder.referenceId)}><FilePlus2 />新建文件</button></div>
              {newFileFor === folder.referenceId && <form className="new-file-form" onSubmit={(event) => { event.preventDefault(); void client.sendCommand({ kind: "managed_file.create_text", referenceId: folder.referenceId, relativePath: newFileName, text: newFileText }); setNewFileFor(undefined); setNewFileText(""); }}><input value={newFileName} onChange={(event) => setNewFileName(event.target.value)} /><textarea value={newFileText} placeholder="文件内容" onChange={(event) => setNewFileText(event.target.value)} /><button>保存</button></form>}
              {folder.files.length === 0 ? <p className="muted small">文件夹为空</p> : folder.files.map((file) => <button className="file-row" key={file.relativePath} onClick={() => setEditingFile({ referenceId: folder.referenceId, ...file })}><span>{file.relativePath}</span><ChevronRight /></button>)}
            </div>)}
          </article>;
        })}</div>
      )}
      {editingFile && <EditorSheet title={editingFile.relativePath} value={editingFile.text} onClose={() => setEditingFile(undefined)} onSave={(text) => { void client.sendCommand({ kind: "managed_file.replace_text", referenceId: editingFile.referenceId, relativePath: editingFile.relativePath, expectedFingerprint: editingFile.fingerprint, text }); setEditingFile(undefined); }} />}
    </section>
  );
}

function NotesScreen({ client, state }: ScreenProps) {
  const [editingNote, setEditingNote] = useState<(typeof state.notebooks)[number]>();
  const [editingAsset, setEditingAsset] = useState<(typeof state.assets)[number]>();
  return (
    <section className="screen-section">
      <div className="screen-heading"><p className="eyebrow">跨设备内容</p><h1>笔记与资产</h1></div>
      <div className="settings-list">
        {state.notebooks.map((notebook) => <button className="settings-row" key={notebook.notebookId} onClick={() => setEditingNote(notebook)}><span><strong>{notebook.label}</strong><small>{notebook.scope === "global" ? "全局" : "工作区"} · {notebook.content.length} 字</small></span><ChevronRight /></button>)}
        {state.assets.map((asset) => <button className="settings-row" key={asset.assetId} onClick={() => setEditingAsset(asset)}><span><strong>{asset.title}</strong><small>{asset.kind === "markdown" ? "Markdown 资产" : `${asset.language} 代码资产`}</small></span><ChevronRight /></button>)}
      </div>
      <div className="screen-heading device-heading"><p className="eyebrow">信任边界</p><h1>设备</h1></div>
      <div className="device-panel"><div><strong>{state.binding?.peerDeviceName ?? "已配对电脑"}</strong><p>配对后完全互信；危险命令仍会请求确认。</p></div><span className={`status-pill ${state.peerOnline ? "ok" : ""}`}>{state.peerOnline ? "在线" : "离线"}</span></div>
      <button className="danger-button" onClick={() => { if (window.confirm("忘记这台电脑并清除本机的协同数据？")) void client.forgetDevice(); }}><Unplug />忘记此设备</button>
      {editingNote && <EditorSheet title={editingNote.label} value={editingNote.content} onClose={() => setEditingNote(undefined)} onSave={(content) => { void client.sendCommand({ kind: "note.replace", notebookId: editingNote.notebookId, expectedVersion: editingNote.version, content }); setEditingNote(undefined); }} />}
      {editingAsset && <EditorSheet title={editingAsset.title} value={editingAsset.text} onClose={() => setEditingAsset(undefined)} onSave={(text) => { void client.sendCommand({ kind: "asset.replace_text", assetId: editingAsset.assetId, expectedFingerprint: editingAsset.fingerprint, text }); setEditingAsset(undefined); }} />}
    </section>
  );
}

function EditorSheet({ title, value, onClose, onSave }: { readonly title: string; readonly value: string; readonly onClose: () => void; readonly onSave: (value: string) => void }) {
  const [text, setText] = useState(value);
  return <div className="sheet-backdrop"><section className="editor-sheet"><div className="sheet-header"><button className="text-button" onClick={onClose}>取消</button><strong>{title}</strong><button className="text-button accent" onClick={() => onSave(text)}>保存</button></div><textarea autoFocus value={text} onChange={(event) => setText(event.target.value)} /></section></div>;
}

function Brand({ compact = false }: { readonly compact?: boolean }) {
  return <div className={`brand ${compact ? "compact" : ""}`}><img src="/favicon.svg" alt="" /><span>AgentArbor</span></div>;
}

function Notice({ children, tone }: { readonly children: ReactNode; readonly tone: "danger" }) {
  return <div className={`notice ${tone}`}><CircleAlert />{children}</div>;
}

function EmptyState({ icon, title, detail }: { readonly icon: ReactNode; readonly title: string; readonly detail: string }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong><p>{detail}</p></div>;
}

function NavButton({ active, label, icon, badge, onClick }: { readonly active: boolean; readonly label: string; readonly icon: ReactNode; readonly badge?: number; readonly onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span className="nav-icon">{icon}{badge ? <b>{badge}</b> : null}</span><span>{label}</span></button>;
}

function statusText(status: string): string {
  const values: Record<string, string> = { pending: "等待中", queued: "已排队", running: "进行中", awaiting_approval: "待确认", completed: "已完成", failed: "失败", cancelled: "已取消", blocked: "已暂停" };
  return values[status] ?? status;
}

function riskText(risk: string): string { return risk === "high" ? "高风险" : risk === "medium" ? "中风险" : "低风险"; }

type ScreenProps = { readonly client: RemoteMobileClient; readonly state: MobileRemoteState };
