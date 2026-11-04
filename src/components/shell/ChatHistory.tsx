import { useEffect, useRef, useState } from 'react';
import { Check, History, Loader2, MessageSquare, Trash2 } from '../ui/icons';
import { Menu } from '../ui/Menu';
import type { ChatMeta, OtherChat } from '../../types';
import { useDismiss, useNow } from '../../lib/hooks';
import { agoLong } from '../../lib/time';

interface Props {
  currentId: string | null;
  disabled: boolean;
  others: OtherChat[];
  onOpen(id: string): void;
  onDelete(id: string): void;
}

const AGENT_NAMES: Record<string, string> = { codex: 'Codex', claude: 'Claude Code' };

export function ChatHistory({ currentId, disabled, others, onOpen, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [chats, setChats] = useState<ChatMeta[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(60_000, open);

  useEffect(() => {
    if (!open) return;
    window.pinpoint.listChats().then(setChats).catch(() => setChats([]));
  }, [open]);
  useDismiss(open, () => setOpen(false), { ref });

  const othersById = new Map(others.map((o) => [o.id, o]));
  const remove = (id: string) => { onDelete(id); setChats((cs) => cs.filter((x) => x.id !== id)); };
  // From the keyboard, focus moves on to the next item (or the one before, or the menu once it's empty).
  const removeFocused = (item: HTMLElement, id: string) => {
    const next = (item.nextElementSibling ?? item.previousElementSibling) as HTMLElement | null;
    const target = next?.getAttribute('role') === 'menuitem' ? next : item.parentElement;
    remove(id);
    setTimeout(() => target?.focus());
  };
  const running = others.filter((o) => o.running).length;

  return (
    <div className="dd" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} disabled={disabled} title="Chat history" aria-label="Chat history" aria-haspopup="menu" aria-expanded={open}>
        <History size={15} />
        {running > 0 && <span className="history-count">{running}</span>}
      </button>
      {open && (
        <Menu className="dd-menu down right history-menu" label="Chats in this project">
          <div className="dd-title" aria-hidden>Chats in this project</div>
          {chats.length === 0 && <div className="route-empty">No saved chats yet</div>}
          {chats.map((c) => {
            const other = othersById.get(c.id);
            return (
              // Delete is the item's Delete key for keyboards; its button is for the mouse, so it stays out of the tab order.
              <div
                key={c.id} role="menuitem" tabIndex={-1} aria-keyshortcuts="Delete Backspace" className={`dd-item history-item ${c.id === currentId ? 'sel' : ''}`}
                onClick={() => { onOpen(c.id); setOpen(false); }} onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') removeFocused(e.currentTarget, c.id); }}
              >
                {other?.running ? <Loader2 size={14} className="dd-item-icon spin" />
                  : other ? <Check size={14} className="dd-item-icon" />
                    : <MessageSquare size={14} className="dd-item-icon" />}
                <span className="dd-item-text">
                  <span>{c.title || 'Untitled'}</span>
                  <small>{agoLong(c.updatedAt, now)} · {c.count} item{c.count === 1 ? '' : 's'}{c.agent ? ` · ${AGENT_NAMES[c.agent] ?? c.agent}` : ''}</small>
                </span>
                <button className="icon-btn xs" title="Delete chat" tabIndex={-1} aria-hidden onClick={(e) => { e.stopPropagation(); remove(c.id); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </Menu>
      )}
    </div>
  );
}
