import { useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, MessageSquare, Trash2 } from './icons';
import type { ChatMeta, OtherChat } from '../lib/types';

interface Props {
  currentId: string | null;
  disabled: boolean;
  others: OtherChat[];
  onOpen(id: string): void;
  onDelete(id: string): void;
}

function ago(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

export function ChatHistory({ currentId, disabled, others, onOpen, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    window.pinpoint.listChats().then(setChats).catch(() => setChats([]));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="dd" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} disabled={disabled} title="Chat history">
        <History size={15} />
        {others.some((o) => o.running) && <span className="history-count">{others.filter((o) => o.running).length}</span>}
      </button>
      {open && (
        <div className="dd-menu down right history-menu">
          <div className="dd-title">Chats in this project</div>
          {chats.length === 0 && <div className="route-empty">No saved chats yet</div>}
          {chats.map((c) => (
            <div key={c.id} className={`dd-item history-item ${c.id === currentId ? 'sel' : ''}`} onClick={() => { onOpen(c.id); setOpen(false); }}>
              {others.find((o) => o.id === c.id)?.running ? <Loader2 size={14} className="dd-item-icon spin" />
                : others.some((o) => o.id === c.id) ? <Check size={14} className="dd-item-icon" />
                  : <MessageSquare size={14} className="dd-item-icon" />}
              <span className="dd-item-text">
                <span>{c.title || 'Untitled'}</span>
                <small>{ago(c.updatedAt)} · {c.count} item{c.count === 1 ? '' : 's'}{c.agent ? ` · ${c.agent === 'codex' ? 'Codex' : 'Claude Code'}` : ''}</small>
              </span>
              <button className="icon-btn xs" title="Delete chat" onClick={(e) => { e.stopPropagation(); onDelete(c.id); setChats(chats.filter((x) => x.id !== c.id)); }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
