import { useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, MessageSquare, Trash2 } from '../ui/icons';
import type { ChatMeta, OtherChat } from '../../types';
import { useDismiss } from '../../lib/hooks';
import { agoLong } from '../../lib/time';

interface Props {
  currentId: string | null;
  disabled: boolean;
  others: OtherChat[];
  onOpen(id: string): void;
  onDelete(id: string): void;
}

export function ChatHistory({ currentId, disabled, others, onOpen, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    window.pinpoint.listChats().then(setChats).catch(() => setChats([]));
  }, [open]);
  useDismiss(open, () => setOpen(false), { ref });

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
                <small>{agoLong(c.updatedAt)} · {c.count} item{c.count === 1 ? '' : 's'}{c.agent ? ` · ${c.agent === 'codex' ? 'Codex' : c.agent === 'claude' ? 'Claude Code' : c.agent}` : ''}</small>
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
