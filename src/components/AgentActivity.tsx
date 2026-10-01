import { useState, type ReactNode } from 'react';
import Icon from './Icon';
import './ConversationExperience.css';
export default function AgentActivity({ count, current, failed, busy, stopped = false, children }: { count: number; current: string; failed: boolean; busy: boolean; stopped?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <section className={`agent-activity${failed ? ' needs-attention' : ''}`} aria-label="Agent activity">
    <button type="button" className="activity-toggle" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><span className={`activity-state${busy ? ' busy' : ''}`} aria-hidden="true"><Icon name={failed ? 'shield' : busy || stopped ? 'code' : 'check'} size={14}/></span><span className="activity-summary"><strong>{failed ? 'An action needs attention' : busy ? current : stopped ? 'Activity stopped' : `${count} ${count===1?'action':'actions'} completed`}</strong><span>{busy ? `${count} ${count===1?'action':'actions'} so far` : 'View what the agent did'}</span></span><Icon name="down" size={13}/></button>
    {failed && !open && <p className="activity-warning">Open the activity to review the failed or blocked action.</p>}
    {open && <div className="activity-content">{children}</div>}
  </section>;
}
