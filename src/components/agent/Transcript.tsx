import { AlertTriangle, Eye, Loader2 } from '../ui/icons';
import { Markdown } from '../chat';
import { uid } from '../../lib/draw';

// The conversation of a side chat or background task: questions, and the agent's turns as they stream in.
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'agent'; id: string; text: string; live: string; steps: number; last?: string; streaming: boolean }
  | { kind: 'error'; id: string; text: string };

export type TranscriptEvent =
  | { type: 'text_delta' | 'text' | 'error'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'done' };

const join = (a: string, b: string) => (a && b ? `${a}\n\n${b}` : a || b);

export function applyEvent(list: TranscriptItem[], e: TranscriptEvent): TranscriptItem[] {
  const last = list[list.length - 1];
  const turn = last?.kind === 'agent' && last.streaming ? last : null;
  const patch = (p: Partial<Extract<TranscriptItem, { kind: 'agent' }>>) => [...list.slice(0, -1), { ...turn!, ...p }];
  const fresh = (p: Partial<Extract<TranscriptItem, { kind: 'agent' }>>): TranscriptItem => ({ kind: 'agent', id: uid(), text: '', live: '', steps: 0, streaming: true, ...p });
  switch (e.type) {
    // Deltas stream into `live`; a finished block replaces them. CLIs that only stream keep `live` until done.
    case 'text_delta': return turn ? patch({ live: turn.live + e.text }) : [...list, fresh({ live: e.text })];
    case 'text': return turn ? patch({ text: join(turn.text, e.text), live: '' }) : [...list, fresh({ text: e.text })];
    case 'tool': {
      const step = `${e.name} ${e.detail || ''}`.trim();
      return turn ? patch({ steps: turn.steps + 1, last: step }) : [...list, fresh({ steps: 1, last: step })];
    }
    case 'error': return e.text === 'Stopped.' ? list : [...list, { kind: 'error', id: uid(), text: e.text }];
    case 'done': return turn ? patch({ streaming: false, text: join(turn.text, turn.live.trim()), live: '' }) : list;
  }
}

export function Transcript({ items, running, stepLabel = 'Looked at' }: { items: TranscriptItem[]; running: boolean; stepLabel?: string }) {
  return (
    <>
      {items.map((it) => it.kind === 'user'
        ? <div key={it.id} className="msg user side-q">{it.text}</div>
        : it.kind === 'error'
          ? <div key={it.id} className="msg error"><AlertTriangle size={13} /> <span>{it.text}</span></div>
          : (
            <div key={it.id} className="side-a">
              {it.steps > 0 && (
                <div className="side-steps" title={it.last}>
                  {it.streaming ? <Loader2 size={11} className="spin" /> : <Eye size={11} />}
                  {stepLabel} {it.steps} thing{it.steps === 1 ? '' : 's'}{it.streaming && it.last ? ` · ${it.last.split(/[\\/]/).pop()}` : ''}
                </div>
              )}
              {it.text || it.live ? <div className="msg agent"><Markdown text={join(it.text, it.live)} /></div> : it.streaming && !it.steps ? <div className="side-steps"><Loader2 size={11} className="spin" /> Thinking…</div> : null}
            </div>
          ))}
      {running && items[items.length - 1]?.kind === 'user' && <div className="side-steps"><Loader2 size={11} className="spin" /> Thinking…</div>}
    </>
  );
}
