import { useState } from 'react';
import { Brain, ChevronRight } from '../../ui/icons';
import { secs } from '../../../lib/time';

export function ThinkingItem({ text, streaming, ms }: { text: string; streaming?: boolean; ms?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`thinking ${streaming ? 'live' : ''}`}>
      <button onClick={() => setOpen(!open)}><Brain size={13} /> <span className={streaming ? 'shimmer' : ''}>{streaming ? 'Thinking…' : ms && ms >= 1000 ? `Thought for ${secs(ms)}` : 'Thought'}</span> <ChevronRight size={12} className={`chev ${open ? 'open' : ''}`} /></button>
      {open && <div className="thinking-body">{text}</div>}
    </div>
  );
}
