import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, RefreshCw, Settings2, Smartphone, Unplug, UserRound } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

type RemoteStatus = {
  readonly state: "unregistered" | "pairing" | "connecting" | "connected" | "offline";
  readonly relayUrl?: string;
  readonly accountId?: string;
  readonly accountHandle?: string;
  readonly displayName?: string;
  readonly deviceId?: string;
  readonly deviceName?: string;
  readonly peerDeviceId?: string;
  readonly peerDeviceName?: string;
  readonly peerOnline: boolean;
  readonly suggestedDeviceName?: string;
  readonly pairingCode?: string;
  readonly pairingExpiresAt?: string;
  readonly pairingStatus?: "waiting_for_mobile" | "waiting_for_approval" | "paired" | "expired" | "rejected";
  readonly error?: { readonly code: string; readonly message: string };
};

const PACKAGED_RELAY_URL = import.meta.env.VITE_AGENTARBOR_RELAY_URL?.trim() ?? "";

export function RemoteCollaborationSettings(): React.ReactElement {
  const [remote, setRemote] = useState<RemoteStatus>();
  const [deviceName, setDeviceName] = useState("");
  const [accountHandle, setAccountHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async (): Promise<void> => {
    const response = await fetch("/api/remote-collaboration/status");
    const body = await response.json() as { remote?: RemoteStatus };
    if (!response.ok || body.remote === undefined) return;
    setRemote(body.remote);
    setAccountHandle(body.remote.accountHandle ?? "");
    setDeviceName((current) => current || body.remote?.suggestedDeviceName || "");
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (remote?.state !== "pairing") return;
    const timer = window.setInterval(() => void action("/api/remote-collaboration/pairings/inspect", { busy: false }), 2_000);
    return () => window.clearInterval(timer);
  }, [remote?.state]);

  const pairingPayload = useMemo(() => {
    if (!remote?.relayUrl || !remote.pairingCode) return undefined;
    const url = new URL("agentarbor://pair");
    url.searchParams.set("relay", remote.relayUrl);
    url.searchParams.set("code", remote.pairingCode);
    return url.toString();
  }, [remote?.relayUrl, remote?.pairingCode]);

  const action = async (url: string, options: { readonly method?: "POST" | "PATCH"; readonly body?: unknown; readonly busy?: boolean } = {}): Promise<void> => {
    if (options.busy !== false) setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(url, {
        method: options.method ?? "POST",
        headers: { "content-type": "application/json" },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const result = await response.json() as { remote?: RemoteStatus; error?: { message?: string } };
      if (!response.ok) throw new Error(result.error?.message ?? "移动协同操作失败");
      if (result.remote !== undefined) {
        setRemote(result.remote);
        setAccountHandle(result.remote.accountHandle ?? "");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "移动协同操作失败");
    } finally {
      if (options.busy !== false) setBusy(false);
    }
  };

  if (remote === undefined) {
    return <div className="remote-settings-loading"><LoaderCircle className="spin" size={18} />正在读取设备状态...</div>;
  }

  return (
    <div className="remote-settings">
      <section className="settings-card remote-settings-card">
        <div className="remote-settings-title">
          <span className="remote-settings-icon"><Smartphone size={19} /></span>
          <div><h3>手机与电脑</h3><p>{remote.state === "unregistered" ? "创建协同账户后即可添加手机" : `账户 @${remote.accountHandle}`}</p></div>
          <span className={`remote-connection-badge ${remote.state}`}>{statusLabel(remote)}</span>
        </div>

        {remote.state === "unregistered" && (
          <div className="remote-activation">
            <button className="settings-primary-action" disabled={busy || PACKAGED_RELAY_URL.length === 0 || deviceName.trim().length === 0} onClick={() => void action("/api/remote-collaboration/account/activate", {
              body: { relayUrl: PACKAGED_RELAY_URL, deviceName: deviceName.trim() },
            })}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />}创建协同账户
            </button>
            <details className="remote-device-options">
              <summary><Settings2 size={14} />设备选项</summary>
              <label>设备名称<input value={deviceName} maxLength={160} spellCheck={false} onChange={(event) => setDeviceName(event.target.value)} /></label>
            </details>
            {PACKAGED_RELAY_URL.length === 0 && <p className="remote-settings-error">当前构建未配置官方协同服务。</p>}
          </div>
        )}

        {remote.state !== "unregistered" && remote.state !== "pairing" && (
          <div className="remote-device-row">
            <div><strong>{remote.deviceName ?? "本机"}</strong><span>{remote.peerDeviceName ? `${remote.peerDeviceName} · ${remote.peerOnline ? "在线" : "离线"}` : "尚未添加手机"}</span></div>
            <div>
              {remote.state === "connected"
                ? <button onClick={() => void action("/api/remote-collaboration/disconnect")}><Unplug size={14} />停止连接</button>
                : <button onClick={() => void action("/api/remote-collaboration/connect")}><RefreshCw size={14} />运行连接</button>}
              {remote.peerDeviceId === undefined
                ? <button className="settings-primary-action" disabled={busy} onClick={() => void action("/api/remote-collaboration/pairings/start")}><Smartphone size={14} />添加手机</button>
                : <button className="danger" disabled={busy} onClick={() => {
                    if (window.confirm(`撤销 ${remote.peerDeviceName ?? "这台手机"} 的访问权限？`)) void action("/api/remote-collaboration/revoke-phone");
                  }}>撤销手机</button>}
            </div>
          </div>
        )}

        {remote.state === "pairing" && remote.pairingCode && (
          <div className="remote-code-panel">
            {pairingPayload && <div className="remote-pairing-qr"><QRCodeSVG value={pairingPayload} size={148} level="M" /></div>}
            <span>{remote.peerDeviceName ? `${remote.peerDeviceName} 正在等待允许` : "使用手机扫描或输入"}</span>
            <strong>{remote.pairingCode.slice(0, 3)} {remote.pairingCode.slice(3)}</strong>
            <div>
              <button onClick={() => void navigator.clipboard.writeText(remote.pairingCode!)}><Copy size={14} />复制</button>
              {remote.pairingStatus === "waiting_for_approval" && <button className="confirm" disabled={busy} onClick={() => void action("/api/remote-collaboration/pairings/approve")}><Check size={14} />允许连接</button>}
            </div>
          </div>
        )}

        {remote.error && <p className="remote-settings-error">{remote.error.message}</p>}
        {error && <p className="remote-settings-error">{error}</p>}
      </section>

      {remote.state !== "unregistered" && (
        <section className="settings-card remote-settings-card">
          <div className="remote-settings-title compact"><span className="remote-settings-icon"><UserRound size={18} /></span><div><h3>账户</h3><p>内部 ID 保持不变，用户名可修改</p></div></div>
          <div className="remote-pairing-form compact">
            <label>用户名<input value={accountHandle} maxLength={32} spellCheck={false} onChange={(event) => setAccountHandle(event.target.value.toLowerCase())} /></label>
            <button disabled={busy || accountHandle === remote.accountHandle} onClick={() => void action("/api/remote-collaboration/account/handle", { method: "PATCH", body: { handle: accountHandle } })}>保存</button>
          </div>
          <button className="danger-button" onClick={() => {
            if (window.confirm("退出后会撤销此电脑的远程凭据；再次使用时需要重新创建账户并重新配对手机。")) void action("/api/remote-collaboration/forget");
          }}>退出此电脑</button>
        </section>
      )}
    </div>
  );
}

function statusLabel(remote: RemoteStatus): string {
  return remote.state === "connected"
    ? remote.peerOnline ? "手机在线" : "中继在线"
    : remote.state === "connecting"
      ? "连接中"
      : remote.state === "offline"
        ? "未运行"
        : remote.state === "pairing" ? "等待手机" : "未创建";
}
