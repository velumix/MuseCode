import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AccessCheck, Diagnostics } from '../context';
import { providerNames } from '../providers';
import { copyText } from './clip';
import Icon from './Icon';
import './ContextPanel.css';

export default function ContextPanel({ load, check, snapshot, onAttach, onClose }: {
  load: () => Promise<Diagnostics>;
  check?: () => Promise<AccessCheck>;
  snapshot: string;
  onAttach?: (label: string, text: string) => void;
  onClose: () => void;
}) {
  const [report, setReport] = useState<Diagnostics | null>(null);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<'report' | 'view'>('report');
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const loadRef = useRef(load); loadRef.current = load;
  async function refresh() {
    setBusy(true); setError(''); setCopied(false);
    try { const next = await loadRef.current(); if (mounted.current) { setReport(next); setAccess(null); } }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    void refresh();
    return () => { mounted.current = false; previous?.focus(); };
  }, []);
  const text = preview === 'view' ? snapshot : report ? JSON.stringify(report, null, 2) : '';
  const label = preview === 'view' ? 'Chat layout snapshot' : 'Velum diagnostics';
  return <div className="context-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="context-panel" role="dialog" aria-modal="true" aria-labelledby="context-title" tabIndex={-1} ref={dialog} onKeyDown={e => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], textarea') || []);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <header><div><span className="context-eyebrow">Project context</span><h2 id="context-title">Know what’s connected.</h2></div><button type="button" aria-label="Close diagnostics" onClick={onClose}><Icon name="close" /></button></header>
      <div className="context-content">
        <p className="context-intro">Every request includes the app version, project, provider, model and a folder-listing check. Attach a report or chat layout below when you want the agent to inspect it.</p>
        {error && <p role="alert" className="context-error">{error}</p>}
        <div className="context-checks" aria-busy={busy}>
          <section><Icon name="folder" /><div><h3>Project access</h3><p>{access?.message || report?.workspace.message || 'Checking the selected project…'}</p>
          {report && <small>{report.workspace.git_repository ? 'Git repository detected' : 'No Git repository detected'} · Checked {new Date((access?.checked_at || report.checked_at) * 1000).toLocaleTimeString()}</small>}
          </div>{check && <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const result = await check(); if (mounted.current) { setAccess(result); setReport(previous => previous ? {...previous, checked_at:result.checked_at, workspace:{...previous.workspace, directory_listing:result.readable, write_access:result.writable, message:result.message}} : previous); } }
            catch (e) { if (mounted.current) setError(String(e)); }
            finally { if (mounted.current) setBusy(false); }
          }}>Test file access</button>}</section>
          {report?.providers.map(p => <section key={p.provider}><Icon name="terminal" /><div><h3>{providerNames[p.provider]}</h3><p>{p.installed ? 'CLI found. Sign-in and tool connections have not been tested.' : 'CLI not found. Install it, then refresh providers.'}</p></div><span className={p.installed ? 'context-tag' : 'context-tag missing'}>{p.installed ? 'Installed' : 'Missing'}</span></section>)}
          {report && <section><Icon name="memory" /><div><h3>Shared & project memory</h3><p>{report.memory.readable ? `${report.memory.notes} notes · ${report.memory.enabled ? `${report.memory.budget_bytes?.toLocaleString()} byte recall budget` : 'Recall disabled'} · ${report.memory.capture} capture` : 'Vault unavailable. Open Memory for details.'}</p><small>Search notes in Memory. Saved suggestions are confirmed in the conversation.</small></div></section>}
        </div>
        <details className="context-permissions"><summary>Antigravity says a command was denied?</summary><p>On your desktop, open Terminal in an Antigravity tab and enter <code>/permissions</code>. Review the rule for the command you need in <code>~/.gemini/antigravity-cli/settings.json</code>, then retry. A deny or ask rule can override an allow rule.</p><a href="https://antigravity.google/docs/permissions?tab=cli" target="_blank" rel="noreferrer" onClick={e => { if (isTauri()) { e.preventDefault(); void openUrl(e.currentTarget.href).catch(error => setError(String(error))); } }}>Permission rules documentation ↗</a></details>
        <div className="context-preview-heading"><div role="group" aria-label="Attachment preview"><button type="button" aria-pressed={preview === 'report'} onClick={() => { setPreview('report'); setCopied(false); }}>Diagnostics</button><button type="button" aria-pressed={preview === 'view'} onClick={() => { setPreview('view'); setCopied(false); }}>Chat layout</button></div><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh checks</button></div>
        <p className="context-caption">{preview === 'view' ? 'Captured when you opened this panel. Layout and viewport only; no message text, drafts or screenshot.' : 'Preview the exact report before sharing. No paths, chat text, tokens, raw logs or memory contents.'}</p>
        <textarea className="context-preview" aria-label={`${label} preview`} value={text} readOnly spellCheck={false} />
      </div>
      <footer><span role="status">{copied ? 'Copied.' : report ? `Velum ${report.version} · ${report.host_os}` : 'Local checks only'}</span><button type="button" disabled={!text || busy} onClick={async () => { if (await copyText(text)) setCopied(true); else setError('Could not copy. Select the preview text to copy it manually.'); }}>Copy</button>{onAttach && <button type="button" className="context-primary" disabled={!text || busy} onClick={() => { try { onAttach(label, text); } catch (e) { setError(String(e)); } }}>Add to message</button>}</footer>
    </div>
  </div>;
}
