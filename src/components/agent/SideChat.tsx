import { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, Square } from '../ui/icons';
import { Transcript, applyEvent, type TranscriptItem } from './Transcript';
import { uid } from '../../lib/draw';
import type { SideEvent } from '../../types';
import { errText } from '../../lib/util';

interface Props {
  sideId: string;
  active: boolean;
  agentName: string;
  seed: string | null;
  onSeedUsed(): void;
  getContext(): string;
  onTitle(title: string): void;
  onRunning(running: boolean): void;
}

export function SideChat({ sideId, active, agentName, seed, onSeedUsed, getContext, onTitle, onRunning }: Props) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const session = useRef<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => { onRunning(running); }, [running]);
  useEffect(() => { if (active) setTimeout(() => input.current?.focus({ preventScroll: true }), 30); }, [active]);
  useEffect(() => {
    if (seed == null) return;
    setText((t) => `${t ? t + '\n' : ''}> ${seed.trim().replace(/\n+/g, '\n> ')}\n`);
    onSeedUsed();
  }, [seed]);
  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [items]);

  useEffect(() => window.pinpoint.onSideEvent((e: SideEvent) => {
    if (e.sideId !== sideId) return;
    if (e.type === 'text_delta' || e.type === 'text' || e.type === 'error' || e.type === 'tool' || e.type === 'done') setItems((list) => applyEvent(list, e));
    if (e.type === 'session') session.current = e.sessionId;
    if (e.type === 'done') { setRunning(false); if (e.sessionId) session.current = e.sessionId; }
  }), [sideId]);

  const ask = async () => {
    const q = text.trim();
    if (!q || running) return;
    if (!items.length) onTitle(q.replace(/^>.*$/gm, '').trim().split('\n')[0].slice(0, 40) || 'Side chat');
    setItems((l) => [...l, { kind: 'user', id: uid(), text: q }]);
    setText('');
    setRunning(true);
    try {
      await window.pinpoint.sideAsk({ sideId: sideId, question: q, context: session.current ? '' : getContext(), sessionId: session.current });
    } catch (err) {
      setRunning(false);
      setItems((l) => [...l, { kind: 'error', id: uid(), text: errText(err) }]);
    }
  };

  const clear = () => {
    if (running) window.pinpoint.sideCancel(sideId);
    setItems([]); session.current = null; setRunning(false);
  };

  return (
    <div className={`side-chat ${active ? '' : 'hidden'}`}>
      <div className="side-head">
        <span className="side-sub" title="Asks the same agent, read-only, in its own session. Nothing here changes files or the main chat.">Side chat · {agentName} · read-only</span>
        <div className="spacer" />
        <button className="icon-btn xs" onClick={clear} disabled={!items.length} title="Start over"><RotateCcw size={13} /></button>
      </div>
      <div className="side-body" ref={body}>
        {items.length === 0 && (
          <div className="side-empty">
            <b>Ask on the side</b>
            <span>Read-only, in its own session. Your chat keeps going.</span>
            <div className="side-suggest">
              {['What did the last change do?', 'Where is this page rendered?', 'Is anything risky in this diff?'].map((q) => (
                <button key={q} onClick={() => { setText(q); setTimeout(() => input.current?.focus({ preventScroll: true }), 0); }}>{q}</button>
              ))}
            </div>
          </div>
        )}
        <Transcript items={items} running={running} />
      </div>
      <div className="side-foot">
        <textarea
          ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder="Ask on the side…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(); }
          }}
        />
        {running
          ? <button className="icon-btn side-send stop" onClick={() => window.pinpoint.sideCancel(sideId)} title="Stop"><Square size={10} weight="fill" /></button>
          : <button className="btn primary side-send" onClick={ask} disabled={!text.trim()} title="Ask (Enter)"><ArrowUp size={14} /></button>}
      </div>
    </div>
  );
}
