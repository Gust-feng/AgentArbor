import React, { useEffect, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, RefreshCw, Smartphone, Unplug } from "lucide-react";

type RemoteStatus = {
  readonly state: "unpaired" | "pairing" | "connecting" | "connected" | "offline";
  readonly relayUrl?: string;
  readonly deviceId?: string;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
  readonly pairingCode?: string;
  readonly pairingExpiresAt?: string;
  readonly lastInboxSequence: number;
  readonly error?: { readonly code: string; readonly message: string };
};

type ConversationSummary = { readonly conversationId: string; readonly title: string };

export function RemoteCollaborationSettings(): React.ReactElement {
  const [remote, setRemote] = useState<RemoteStatus>();
  const [relayUrl, setRelayUrl] = useState("http://127.0.0.1:4310");
  const [deviceName, setDeviceName] = useState("我的电脑");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [conversations, setConversations] = useState<readonly ConversationSummary[]>([]);

  const refresh = async (): Promise<void> => {
    const [statusResponse, conversationsResponse] = await Promise.all([
      fetch("/api/remote-collaboration/status"),
      fetch("/api/conversations"),
    ]);
    const statusBody = await statusResponse.json() as { remote?: RemoteStatus };
    const conversationsBody = await conversationsResponse.json() as { conversations?: readonly ConversationSummary[] };
    if (statusResponse.ok && statusBody.remote !== undefined) {
      setRemote(statusBody.remote);
      if (statusBody.remote.relayUrl) setRelayUrl(statusBody.remote.relayUrl);
    }
    if (conversationsResponse.ok) setConversations(conversationsBody.conversations ?? []);
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (remote?.state !== "pairing") return;
    const timer = window.setInterval(() => void action("/api/remote-collaboration/pairings/inspect", false), 2_000);
    return () => window.clearInterval(timer);
  }, [remote?.state]);

  const action = async (url: string, showBusy = true, body?: unknown): Promise<void> => {
    if (showBusy) setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json() as { remote?: RemoteStatus; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "移动协同操作失败");
      if (result.remote !== undefined) setRemote(result.remote);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移动协同操作失败");
    } finally {
      if (showBusy) setBusy(false);
    }
  };

  if (remote === undefined) {
    return <div className="remote-settings-loading"><LoaderCircle className="spin" size={18} />正在读取设备状态…</div>;
  }

  return (
    <div className="remote-settings">
      <section className="settings-card remote-settings-card">
        <div className="remote-settings-title">
          <span className="remote-settings-icon"><Smartphone size={19} /></span>
          <div><h3>手机与电脑</h3><p>配对后作为同一个用户互相信任，直到撤销设备。</p></div>
          <span className={`remote-connection-badge ${remote.state}`}>{statusLabel(remote.state)}</span>
        </div>

        {remote.state === "unpaired" && (
          <div className="remote-pairing-form">
            <label>Relay 地址<input value={relayUrl} onChange={(event) => setRelayUrl(event.target.value)} /></label>
            <label>电脑名称<input value={deviceName} maxLength={160} onChange={(event) => setDeviceName(event.target.value)} /></label>
            <button className="settings-primary-action" disabled={busy} onClick={() => void action("/api/remote-collaboration/pairings", true, { relayUrl, deviceName })}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}创建配对
            </button>
          </div>
        )}

        {remote.state === "pairing" && remote.pairingCode && (
          <div className="remote-code-panel">
            <span>在手机上输入并核对</span>
            <strong>{remote.pairingCode.slice(0, 3)} {remote.pairingCode.slice(3)}</strong>
            <div>
              <button onClick={() => void navigator.clipboard.writeText(remote.pairingCode!)}><Copy size={14} />复制</button>
              <button className="confirm" disabled={busy} onClick={() => void action("/api/remote-collaboration/pairings/confirm")}><Check size={14} />号码一致，确认</button>
            </div>
          </div>
        )}

        {(remote.state === "connected" || remote.state === "offline" || remote.state === "connecting") && (
          <div className="remote-device-row">
            <div><strong>{remote.peerDeviceName ?? "已配对手机"}</strong><span>{remote.relayUrl}</span></div>
            <div>
              {remote.state === "connected"
                ? <button onClick={() => void action("/api/remote-collaboration/disconnect")}><Unplug size={14} />断开</button>
                : <button onClick={() => void action("/api/remote-collaboration/connect")}><RefreshCw size={14} />连接</button>}
              <button className="danger" onClick={() => {
                if (window.confirm("忘记这台手机并清除本地连接凭据？")) void action("/api/remote-collaboration/forget");
              }}>忘记设备</button>
            </div>
          </div>
        )}
        {remote.error && <p className="remote-settings-error">{remote.error.message}</p>}
        {error && <p className="remote-settings-error">{error}</p>}
        <p className="remote-security-note">当前同步正文不使用端到端加密；公网部署必须使用 HTTPS/WSS。</p>
      </section>

      <section className="settings-card remote-settings-card">
        <div className="remote-settings-title compact"><div><h3>共享对话</h3><p>手机创建的对话自动共享；电脑已有对话需在这里明确加入。</p></div></div>
        <div className="remote-conversation-list">
          {conversations.length === 0 ? <p>暂无可共享对话</p> : conversations.slice(0, 20).map((conversation) => (
            <div key={conversation.conversationId}><span>{conversation.title}</span><button onClick={() => void action(`/api/remote-collaboration/conversations/${encodeURIComponent(conversation.conversationId)}/share`)}>共享</button></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function statusLabel(status: RemoteStatus["state"]): string {
  return status === "connected" ? "已连接" : status === "connecting" ? "连接中" : status === "offline" ? "已配对 · 离线" : status === "pairing" ? "配对中" : "未配对";
}
