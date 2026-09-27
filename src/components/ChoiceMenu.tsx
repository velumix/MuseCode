import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
export interface Choice { id: string; label: string; description?: string }
export default function ChoiceMenu({ label, value, choices, disabled, onChange }: { label: string; value: string; choices: Choice[]; disabled?: boolean; onChange: (value: string) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 350 });
  const selected = choices.find((choice) => choice.id === value);
  const filtered = choices.filter((choice) => `${choice.label} ${choice.id}`.toLowerCase().includes(query.toLowerCase()));
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false); };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    (menu.current?.querySelector<HTMLElement>('[aria-selected="true"]') || menu.current?.querySelector<HTMLElement>('[role="option"]'))?.focus();
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resize); };
  }, [open]);
  const show = () => {
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 20;
    const height = Math.min(350, Math.max(below, rect.top - 20));
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: below >= height ? rect.bottom + 7 : Math.max(12, rect.top - height - 7), width, maxHeight: height });
    setQuery(""); setOpen(true);
  };
  return <>
    <button ref={trigger} type="button" className="choice-trigger" aria-label={`${label}: ${selected?.label || value || "Default"}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); show(); } }}>
      <span><small>{label}</small><strong>{selected?.label || value || "Default"}</strong></span><svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    </button>
    {open && createPortal(<div ref={menu} className="choice-menu" style={position} onBlur={(e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== trigger.current) setOpen(false); }} onKeyDown={(e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="option"]') || []);
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (index + 1) % items.length : e.key === "ArrowUp" ? (index - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
      if (next >= 0 && items[next]) { e.preventDefault(); items[next].focus(); }
    }}>
      <div className="choice-heading">Choose {label.toLowerCase()}</div>
      {choices.length > 6 && <div className="choice-search"><Icon name="search" size={15} /><input aria-label={`Search ${label.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a model or option…" /></div>}
      <div id={id} className="choice-options" role="listbox" aria-label={label}>{filtered.map((choice) => <button key={choice.id} type="button" role="option" aria-selected={choice.id === value} tabIndex={choice.id === value ? 0 : -1} onClick={() => { onChange(choice.id); close(); }}>
        <span><strong>{choice.label}</strong>{choice.description && <small>{choice.description}</small>}</span>{choice.id === value && <Icon name="check" size={16} />}
      </button>)}</div>
      {!filtered.length && <p className="choice-empty">No matching options</p>}
    </div>, document.body)}
  </>;
}
