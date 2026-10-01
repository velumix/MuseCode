import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { AccessCheck, Diagnostics } from '../context';
import { providerNames } from '../providers';
import { progressMessage } from '../providerProgress';
import { copyText } from './clip';
import Icon from './Icon';
import './ContextPanel.css';

export default function ContextPanel({ load, check, checkAgent, agentBusy, snapshot, onAttach, onClose }: {
  load: () => Promise<Diagnostics>;
  check?: () => Promise<AccessCheck>;
  checkAgent?: () => Promise<unknown>;
  agentBusy?: boolean;
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
  useEffect(() => {
    if (!report?.workspace_access?.agent.running && !report?.provider_runtime?.running) return;
    const timer = window.setTimeout(() => void refresh(), 1500);
    return () => window.clearTimeout(timer);
  }, [report]);
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
        <p className="context-intro">Host checks and active agent checks are separate. Test agent access runs a turn in this conversation using a unique temporary file directly in the selected workspace. Ordinary chat commands do not update these diagnostics. Permission and session changes invalidate previous results.</p>
        {report?.workspace_access?.selection?.guidance && <p role="status" className="context-error">{report.workspace_access.selection.guidance}</p>}
        {error && <p role="alert" className="context-error">{error}</p>}
        <div className="context-checks" aria-busy={busy}>
          <section><Icon name="folder" /><div><h3>Project access</h3><p>{access?.message || report?.workspace.message || 'Checking the selected project…'}</p>
          {report && <small>{report.workspace.git_repository ? 'Git repository detected' : 'No Git repository detected'} · Checked {new Date((access?.checked_at || report.checked_at) * 1000).toLocaleTimeString()}</small>}
          </div>{check && <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError('');
            try { const result = await check(); if (mounted.current) { setAccess(result); setReport(previous => previous ? {...previous, checked_at:result.checked_at, workspace:{...previous.workspace, message:result.message}, workspace_access: previous.workspace_access && result.sanitized ? {...previous.workspace_access,host:result.sanitized} : previous.workspace_access} : previous); } }
            catch (e) { if (mounted.current) setError(String(e)); }
            finally { if (mounted.current) setBusy(false); }
          }}>Test host access</button>}</section>
          {report?.workspace_access && <section><Icon name="shield"/><div><h3>Active agent access</h3>
            <p>Requested: {report.workspace_access.permissions.requested_mode} · Launched: {report.workspace_access.permissions.launched_mode || 'untested'}</p>
            <small>Effective restrictions: {report.workspace_access.permissions.effective.sandbox || report.workspace_access.permissions.effective.status}{report.workspace_access.permissions.effective.approval_policy ? ` · approvals: ${report.workspace_access.permissions.effective.approval_policy}` : ''}</small>
            {report.workspace_access.agent.running && <p role="status">Agent probe running. Results appear when the turn finishes.</p>}
          </div>{checkAgent && <button type="button" disabled={busy || agentBusy || report.workspace_access.agent.running} onClick={async () => {
            setBusy(true); setError('');
            try { await checkAgent(); await refresh(); }
            catch (e) { if (mounted.current) setError(String(e)); }
            finally { if (mounted.current) setBusy(false); }
          }}>Test agent access</button>}</section>}
          {report?.workspace_access && <div className="access-table-wrap"><table className="access-table"><caption>Workspace operations</caption><thead><tr><th>Operation</th><th>Host</th><th>Agent</th></tr></thead><tbody>
            {report.workspace_access.agent.checks.map((agent, index) => { const host = report.workspace_access!.host.checks[index]; return <tr key={agent.operation}><th>{agent.operation.replace(/_/g, ' ')}</th>{[host, agent].map((check, column) => <td key={column}><details><summary className={`access-${check.status}`}>{check.status}</summary><p>{check.detail}</p><small>{check.path}<br/>{check.environment}<br/>{check.checked_at ? new Date(check.checked_at * 1000).toLocaleString() : 'Not tested'}{check.error_code ? ` · ${check.error_code}` : ''}{check.exit_code !== null ? ` · exit ${check.exit_code}` : ''}</small></details></td>)}</tr>; })}
          </tbody></table>{report.workspace_access.agent.host_cleanup && <p className="context-caption">Probe fixture cleanup by host: {report.workspace_access.agent.host_cleanup.status}. {report.workspace_access.agent.host_cleanup.detail}</p>}</div>}
          {report?.provider_runtime && <section><Icon name="terminal"/><div><h3>Active provider</h3><p>{providerNames[report.provider_runtime.provider]} · {report.provider_runtime.turn_status}</p>
            {report.provider_runtime.progress && <p>{progressMessage(report.provider_runtime.progress)}</p>}
            {report.provider_runtime.last_retry && <small>Last retry: {progressMessage(report.provider_runtime.last_retry)} · {new Date(report.provider_runtime.last_retry.checked_at_ms).toLocaleString()}</small>}
            <small>{report.provider_runtime.detail}</small></div></section>}
          {report?.agent_tools && <section><Icon name="settings"/><div><h3>Velum tools</h3><p>{report.agent_tools.enabled ? 'Enabled' : 'Disabled'} · Project search, file inspection and Git status</p><p>File removal: {report.agent_tools.delete_file ? 'enabled' : 'off'} · Vault search: {report.agent_tools.vault_search ? 'enabled' : 'off'}</p><p>Isolated browser: {report.agent_tools.isolated_browser ? 'available' : 'off or unavailable'} · Desktop capture: {report.agent_tools.native_screenshot ? 'enabled' : 'off'} · Native input: {report.agent_tools.native_input ? 'enabled' : 'off'}</p><small>{report.agent_tools.scope}</small></div></section>}
          {report?.turn_measurement && <section><Icon name="terminal"/><div><h3>Turn measurement</h3><p>{report.turn_measurement.finished ? 'Completed turn' : 'Running turn'} · {report.turn_measurement.elapsed_ms.toLocaleString()} ms host · {report.turn_measurement.counters?.output_tokens?.toLocaleString() ?? 'Unreported'} output tokens</p>
            {report.turn_measurement.counters?.output_tokens == null && <p>{report.turn_measurement.finished ? 'The provider did not report output token counts for this turn.' : 'Awaiting provider output token counts. The final rate appears after the turn finishes.'}</p>}
            <p>Tools: {report.turn_measurement.mcp_initialized ? 'connected in this turn' : 'no connection observed'} · {report.turn_measurement.tool_calls} calls · {report.turn_measurement.tool_errors} errors</p><small>{report.turn_measurement.counter_source}. {report.client_measurement?.complete ? 'Independent completed client timing is included below.' : report.client_measurement?.elapsed_ms != null ? 'Client timing is still running; refresh after the turn finishes for the completed report.' : 'No complete client timing observation for this turn.'} No host tokenizer is claimed.</small></div></section>}
          {report?.providers.map(p => <section key={p.provider}><Icon name="terminal" /><div><h3>{providerNames[p.provider]}</h3><p>{p.installed ? 'CLI found. Installation alone does not verify sign-in or tool connections.' : 'CLI not found. Install it, then refresh providers.'}</p></div><span className={p.installed ? 'context-tag' : 'context-tag missing'}>{p.installed ? 'Installed' : 'Missing'}</span></section>)}
          {report && <section><Icon name="memory" /><div><h3>Shared & project memory</h3><p>{report.memory.readable ? `${report.memory.notes} notes · ${report.memory.enabled ? `${report.memory.budget_bytes?.toLocaleString()} byte recall budget` : 'Recall disabled'} · ${report.memory.capture} capture` : 'Vault unavailable. Open Memory for details.'}</p><small>Search notes in Memory. Saved suggestions are confirmed in the conversation.</small></div></section>}
          {report?.connections && <section><Icon name="settings"/><div><h3>Connection health</h3>{report.connections.map(connection => <p key={connection.name}>{connection.name}: {connection.status}</p>)}<small>Live provider connection checks have not been run by this report.</small></div></section>}
          {report?.attachments && <section><Icon name="settings"/><div><h3>UI and document sessions</h3><p>{report.attachments.detail}</p></div></section>}
        </div>
        <details className="context-permissions"><summary>Antigravity says a command was denied?</summary><p>On your desktop, open Terminal in an Antigravity tab and enter <code>/permissions</code>. Review the rule for the command you need in <code>~/.gemini/antigravity-cli/settings.json</code>, then retry. A deny or ask rule can override an allow rule.</p><a href="https://antigravity.google/docs/permissions?tab=cli" target="_blank" rel="noreferrer" onClick={e => { if (isTauri()) { e.preventDefault(); void openUrl(e.currentTarget.href).catch(error => setError(String(error))); } }}>Permission rules documentation ↗</a></details>
        <div className="context-preview-heading"><div role="group" aria-label="Attachment preview"><button type="button" aria-pressed={preview === 'report'} onClick={() => { setPreview('report'); setCopied(false); }}>Diagnostics</button><button type="button" aria-pressed={preview === 'view'} onClick={() => { setPreview('view'); setCopied(false); }}>Chat layout</button></div><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh report</button></div>
        <p className="context-caption">{preview === 'view' ? 'Captured when you opened this panel. Layout and viewport only; no message text, drafts or screenshot.' : 'Preview the exact report before sharing. Token counts and timing included. No paths, chat text, credential values, raw logs or memory contents.'}</p>
        <textarea className="context-preview" aria-label={`${label} preview`} value={text} readOnly spellCheck={false} />
      </div>
      <footer><span role="status">{copied ? 'Copied.' : report ? `Velum ${report.version} · ${report.host_os}` : 'Local checks only'}</span><button type="button" disabled={!text || busy} onClick={async () => { if (await copyText(text)) setCopied(true); else setError('Could not copy. Select the preview text to copy it manually.'); }}>Copy</button>{onAttach && <button type="button" className="context-primary" disabled={!text || busy} onClick={() => { try { onAttach(label, text); } catch (e) { setError(String(e)); } }}>Add to message</button>}</footer>
    </div>
  </div>;
}
