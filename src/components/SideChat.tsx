import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, Eye, Loader2, RotateCcw, Square } from './icons';
import { Markdown } from './Chat';
import { uid } from '../lib/draw';
import type { SideEvent } from '../lib/types';

type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string; live: string; steps: number; last?: string; streaming: boolean }
  | { kind: 'error'; id: string; text: string };

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
const join = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a || b);

export function SideChat({ sideId, active, agentName, seed, onSeedUsed, getContext, onTitle, onRunning }: Props) {
  const [items, setItems] = useState<Item[]>([]);
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
    setItems((list) => {
      const last = list[list.length - 1];
      const turn = last?.kind === 'agent' && last.streaming ? last : null;
      const patch = (p: Partial<Extract<Item, { kind: 'agent' }>>) => [...list.slice(0, -1), { ...turn!, ...p }];
      const fresh = (p: Partial<Extract<Item, { kind: 'agent' }>>): Item => ({ kind: 'agent', id: uid(), text: '', live: '', steps: 0, streaming: true, ...p });
      switch (e.type) {
        // Deltas stream into `live`; a finished block replaces them. CLIs that only stream keep `live` until done.
        case 'text_delta': return turn ? patch({ live: turn.live + e.text }) : [...list, fresh({ live: e.text })];
        case 'text': return turn ? patch({ text: join(turn.text, e.text), live: '' }) : [...list, fresh({ text: e.text })];
        case 'tool': return turn ? patch({ steps: turn.steps + 1, last: `${e.name} ${e.detail}`.trim() }) : [...list, fresh({ steps: 1, last: `${e.name} ${e.detail}`.trim() })];
        case 'error': return e.text === 'Stopped.' ? list : [...list, { kind: 'error', id: uid(), text: e.text }];
        case 'done': return turn ? patch({ streaming: false, text: join(turn.text, turn.live.trim()), live: '' }) : list;
        default: return list;
      }
    });
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
      setItems((l) => [...l, { kind: 'error', id: uid(), text: String((err as Error).message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }]);
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
        {items.map((it) => it.kind === 'user'
          ? <div key={it.id} className="msg user side-q">{it.text}</div>
          : it.kind === 'error'
            ? <div key={it.id} className="msg error"><AlertTriangle size={13} /> <span>{it.text}</span></div>
            : (
              <div key={it.id} className="side-a">
                {it.steps > 0 && (
                  <div className="side-steps" title={it.last}>
                    {it.streaming ? <Loader2 size={11} className="spin" /> : <Eye size={11} />}
                    Looked at {it.steps} thing{it.steps === 1 ? '' : 's'}{it.streaming && it.last ? ` · ${it.last.split(/[\\/]/).pop()}` : ''}
                  </div>
                )}
                {it.text || it.live ? <div className="msg agent"><Markdown text={join(it.text, it.live)} /></div> : it.streaming && !it.steps ? <div className="side-steps"><Loader2 size={11} className="spin" /> Thinking…</div> : null}
              </div>
            ))}
        {running && items[items.length - 1]?.kind === 'user' && <div className="side-steps"><Loader2 size={11} className="spin" /> Thinking…</div>}
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
