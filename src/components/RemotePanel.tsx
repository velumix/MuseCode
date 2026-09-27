import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import Icon from "./Icon";
import { copyText } from "./clip";
import "./RemotePanel.css";

interface Device { id: string; name: string; control: boolean; created_at: number; expires_at: number }
interface RemoteStatus {
  enabled: boolean; url: string | null; error: string | null;
  tailscale: { installed: boolean; connected: boolean; hostname: string | null; message: string };
  devices: Device[];
  pending: { name: string; code: string; expires_at: number } | null;
  usb: UsbDevice | null;
}
interface UsbDevice { serial: string; name: string; authorized: boolean }
interface Invitation { url: string; svg: string; code: string; expires_at: number }

export default function RemotePanel({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [control, setControl] = useState(true);
  const [time, setTime] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [transport, setTransport] = useState<"tailscale" | "usb">("tailscale");
  const [usbDevices, setUsbDevices] = useState<UsbDevice[]>([]);
  const [usbChecked, setUsbChecked] = useState(false);
  const refreshUsb = async () => { setUsbDevices(await invoke<UsbDevice[]>("remote_usb_devices")); setUsbChecked(true); };

  useEffect(() => {
    if (!returnFocus.current) returnFocus.current = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    let disposed = false;
    let off: (() => void) | undefined;
    const update = async () => {
      try { const value = await invoke<RemoteStatus>("remote_status"); if (!disposed) setStatus(value); }
      catch (e) { if (!disposed) setError(String(e)); }
    };
    void listen<RemoteStatus>("remote-status", ({ payload }) => { if (!disposed) setStatus(payload); }).then((fn) => { if (disposed) fn(); else off = fn; });
    void update();
    const timer = window.setInterval(() => { setTime(Date.now()); void update(); }, 2000);
    return () => {
      disposed = true; off?.(); clearInterval(timer); element?.close();
      requestAnimationFrame(() => { if (!element?.isConnected && returnFocus.current?.isConnected) returnFocus.current.focus(); });
    };
  }, []);

  const action = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await run(); setStatus(await invoke<RemoteStatus>("remote_status")); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  const expired = !!invitation && invitation.expires_at * 1000 <= time;
  const pending = status?.pending && status.pending.expires_at * 1000 > time ? status.pending : null;
  const seconds = invitation ? Math.max(0, Math.ceil(invitation.expires_at - time / 1000)) : 0;
  const setupLink = /https:\/\/login\.tailscale\.com\/f\/serve\?[^\s]+/.exec(error || status?.error || "")?.[0];

  return <dialog ref={dialog} className="remote-dialog" aria-labelledby="remote-title" onCancel={onClose}>
    <header className="remote-heading">
      <div className="remote-symbol"><Icon name="phone" size={25} /></div>
      <div><span className="section-label">Your workspace, wherever you are</span><h2 id="remote-title">Connect your phone</h2></div>
      <button className="remote-icon-button" aria-label="Close remote access" onClick={onClose}><Icon name="close" /></button>
    </header>
    <p className="remote-intro">Your desktop does the work. Your phone keeps you in the conversation.</p>
    <div className="remote-transport" role="group" aria-label="Connection method">
      <button aria-pressed={transport === "tailscale"} onClick={() => { setTransport("tailscale"); setError(""); }}>Tailscale</button>
      <button aria-pressed={transport === "usb"} onClick={() => { setTransport("usb"); void action(refreshUsb); }}>USB cable</button>
    </div>
    {(error || (transport === "tailscale" && status?.error)) && <div className="remote-error" role="alert">{error || status?.error}{transport === "tailscale" && setupLink && <div className="remote-actions"><button onClick={() => void openUrl(setupLink).catch((e) => setError(String(e)))}>Enable HTTPS in Tailscale<Icon name="arrow" size={15} /></button></div>}</div>}
    {transport === "usb" ? <section className="remote-network remote-usb" aria-label="USB connection">
      <div className="remote-network-label"><Icon name="phone" size={20} /><div><strong>One cable. Same conversation.</strong><span>Connect directly to your computer. No Tailscale or Wi-Fi needed.</span></div></div>
      <ol className="remote-usb-steps"><li>Install the Velum Code APK on your phone.</li><li>Use a USB data cable, enable USB debugging, and allow this computer.</li><li>Connect below, then approve the matching code.</li></ol>
      <div className="remote-actions"><button disabled={busy} onClick={() => void action(refreshUsb)}><Icon name="reset" size={16} />Find USB phones</button>{status?.usb && <button disabled={busy} onClick={() => void action(() => invoke("remote_usb_disconnect"))}>Disconnect USB</button>}</div>
      {usbChecked && !usbDevices.length && <p className="remote-muted">No phone detected. Unlock your phone and check its USB debugging prompt, then refresh.</p>}
      {usbDevices.map((device) => <div className="remote-device" key={device.serial}><Icon name="phone" /><div><strong>{device.name}</strong><span>{device.authorized ? status?.usb?.serial === device.serial ? "USB link enabled" : "Ready to connect" : "Allow USB debugging on this phone"}</span></div><button className="remote-primary" disabled={busy || !device.authorized || (!!status?.usb && status.usb.serial !== device.serial)} onClick={() => void action(async () => { await invoke("remote_usb_connect", { serial: device.serial }); setInvitation(null); })}>{status?.usb?.serial === device.serial ? "Reconnect" : "Connect"}</button></div>)}
      {status?.usb && <p className="remote-muted">Open Velum Code on {status.usb.name}. If you unplug the cable, reconnect it and choose Reconnect here.</p>}
    </section> : <section className="remote-network" aria-label="Private network">
      <div className="remote-network-label"><Icon name="shield" size={20} /><div><strong>Private with Tailscale</strong><span>{status?.tailscale.message || "Checking your connection…"}</span></div></div>
      <div className="remote-actions">
        {status && !status.tailscale.installed && <button onClick={() => void openUrl("https://tailscale.com/download/windows").catch((e) => setError(String(e)))}>Get Tailscale <Icon name="arrow" size={15} /></button>}
        <button disabled={busy} aria-label="Refresh Tailscale status" onClick={() => void action(() => invoke("remote_check_tailscale"))}><Icon name="reset" size={16} />Refresh</button>
        <button className={status?.enabled ? "" : "remote-primary"} disabled={busy || (!status?.enabled && !status?.tailscale.connected)} onClick={() => void action(async () => {
          await invoke("remote_enable", { enabled: !status?.enabled }); setInvitation(null);
        })}>{busy ? "Please wait…" : status?.enabled ? "Turn off" : "Enable remote access"}</button>
      </div>
    </section>}
    {pending ? <section className="remote-pair-request" aria-label="Confirm phone pairing">
        <span className="section-label">A phone wants to connect</span><h3>{pending.name}</h3>
        <p>Check that this code matches the one on your phone.</p><div className="remote-code">{pending.code}</div>
        <label className="remote-control"><input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} />Allow sending messages and stopping tasks</label>
        <div className="remote-actions"><button disabled={busy} onClick={() => void action(async () => { await invoke("remote_cancel_pairing"); setInvitation(null); })}>Decline</button><button disabled={busy} className="remote-primary" onClick={() => void action(async () => { await invoke("remote_approve", { code: pending.code, control }); setInvitation(null); })}>Connect phone</button></div>
      </section> : transport === "tailscale" && (status?.enabled ? <>
      <div className="remote-address"><span className="remote-live-dot" /><span title={status.url ?? ""}>{status.url}</span><button className="remote-icon-button" aria-label="Copy private address" onClick={() => void copyText(status.url ?? "").then((ok) => { setCopied(ok); setTimeout(() => setCopied(false), 1500); })}><Icon name={copied ? "check" : "copy"} size={16} /></button></div>
      <section className="remote-pair-layout">
        <div className="remote-qr">
          {invitation && !expired ? <img src={`data:image/svg+xml,${encodeURIComponent(invitation.svg)}`} alt="Scan this QR code with your phone camera to pair with Velum Code" /> : <div className="remote-qr-empty"><Icon name="phone" size={42} /><span>{expired ? "QR code expired" : "Ready when you are"}</span></div>}
        </div>
        <div className="remote-pair-copy"><h3>One scan. Same conversation.</h3><ol><li>Connect your phone to the same Tailscale network.</li><li>Scan the QR with your phone’s camera.</li><li>Confirm the code here, then add Velum Code to your home screen.</li></ol>
          <button className="remote-primary" disabled={busy} onClick={() => void action(async () => { setInvitation(await invoke<Invitation>("remote_pair")); setTime(Date.now()); setControl(true); })}>{invitation ? "Generate new QR code" : "Show pairing code"}</button>
          {invitation && !expired && <span className="remote-expiry">Expires in {seconds}s · single use</span>}
        </div>
      </section>
    </> : <div className="remote-off"><Icon name="phone" size={34} /><div><h3>A little more freedom.</h3><p>Read live responses, send a follow-up, and stop a task from your phone. Velum Code keeps working in the tray.</p></div></div>)}
    <section className="remote-devices" aria-label="Connected devices"><div className="remote-devices-heading"><h3>Connected devices</h3><span>{status?.devices.length ?? 0}</span></div>
      {!status?.devices.length && <p className="remote-muted">Your paired phones will appear here. You can disconnect them at any time.</p>}
      {status?.devices.map((device) => <div className="remote-device" key={device.id}><Icon name="phone" /><div><strong>{device.name}</strong><span>{device.control ? "Can view and control" : "View only"} · paired {new Date(device.created_at * 1000).toLocaleDateString()}</span></div><button disabled={busy} onClick={() => void action(() => invoke("remote_revoke", { id: device.id }))}>Disconnect</button></div>)}
    </section>
    <p className="remote-footnote">Keep your desktop awake and Velum Code running. Phone messages use standard agent permissions. Terminal sessions stay on your desktop.</p>
  </dialog>;
}
