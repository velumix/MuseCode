import { useEffect, useState } from 'react';
import type { MessageQueue as Queue, QueueRequest } from '../messageQueue';
import Icon from './Icon';
import './MessageQueue.css';

export default function MessageQueue({ queue, running, readOnly = false, maxLength = 64000, onAction }: {
  queue: Queue; running: boolean; readOnly?: boolean; maxLength?: number;
  onAction: (request: QueueRequest) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (editing && !queue.items.some(item => item.id === editing)) setEditing(null);
  }, [queue.items, editing]);
  if (!queue.items.length) return null;
  async function act(request: QueueRequest) {
    setBusy(true); setError('');
    try { await onAction(request); if (request.action === 'edit') setEditing(null); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <section className={`message-queue${queue.paused ? ' paused' : ''}`} aria-label="Message queue">
    <header><strong>{queue.items.length} queued</strong><span>{queue.paused ? 'Paused' : running ? 'After this response' : 'Starting next'}</span>
      {!readOnly && <div className="queue-actions"><button type="button" disabled={busy} onClick={() => void act({ action: queue.paused ? 'resume' : 'pause' })}>{queue.paused ? 'Resume queue' : 'Pause queue'}</button><button type="button" disabled={busy} onClick={() => void act({ action: 'clear' })}>Clear queue</button></div>}
    </header>
    {queue.paused && queue.reason && <p className="queue-reason" role="status">{queue.reason}</p>}
    <ol>{queue.items.map((item, index) => <li key={item.id}>
      <span className="queue-position" aria-hidden="true">{index + 1}</span>
      {editing === item.id ? <form onSubmit={event => { event.preventDefault(); void act({ action: 'edit', message_id: item.id, prompt: draft }); }}>
        <textarea autoFocus aria-label={`Edit queued message ${index + 1}`} maxLength={maxLength} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} />
        <div><button disabled={busy || !draft.trim()} type="submit">Save queued message</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel edit</button></div>
      </form> : <><div className="queue-copy"><p>{item.prompt}</p>{item.remote && <small>From phone</small>}{item.yolo && <small>YOLO</small>}</div>
        {!readOnly && <div className="queue-item-actions"><button type="button" aria-label={`Edit queued message ${index + 1}`} disabled={busy} onClick={() => { setDraft(item.prompt); setEditing(item.id); setError(''); }}><Icon name="edit" size={14}/></button><button type="button" aria-label={`Remove queued message ${index + 1}`} disabled={busy} onClick={() => void act({ action: 'remove', message_id: item.id })}><Icon name="close" size={14}/></button></div>}</>}
    </li>)}</ol>
    {error && <p className="queue-error" role="alert">{error}</p>}
  </section>;
}
