import { useEffect, useState } from 'react';
import { Clock, CornerDownRight, GitFork, Layers, Pencil, Pin, RotateCw, Undo2, Zap } from '../../ui/icons';
import type { ChatActions, ItemOf } from '../types';
import { CopyButton } from './CopyButton';

const STEER_TAG = {
  queue: { icon: CornerDownRight, text: 'Steered after the current step' },
  now: { icon: Zap, text: 'Interrupted and sent' },
  later: { icon: Clock, text: 'Queued: sends when the agent finishes' },
};

function RewindButton({ onRewind }: { onRewind(): void }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 2500); return () => clearTimeout(t); }, [sure]);
  return (
    <button className={sure ? 'sure' : ''} onClick={() => (sure ? (setSure(false), onRewind()) : setSure(true))} title={sure ? 'Click again to undo every run after this message' : 'Rewind: undo the file changes made after this message'}>
      <Undo2 size={12} />
    </button>
  );
}

function Attachments({ annotations }: { annotations: ItemOf<'user'>['annotations'] }) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = annotations.find((a) => a.id === open);
  return (
    <>
      <div className="msg-attachments compact">
        {annotations.map((a) => (
          <button key={a.id} className={`msg-att ${open === a.id ? 'on' : ''}`} title={a.note || (a.image ? 'Show the image' : '')} disabled={!a.image} onClick={() => setOpen(open === a.id ? null : a.id)}>
            <span className="badge sm" style={{ background: a.color }}>{a.n}</span>
            {a.kind === 'flow' ? `${a.steps?.length || 0} steps` : a.kind === 'request' ? `${a.request?.method} ${a.request?.status || 'ERR'}` : a.kind}
          </button>
        ))}
      </div>
      {shown?.image && <img className="msg-att-full" src={shown.image} alt="" onClick={() => setOpen(null)} />}
    </>
  );
}

export function UserItem({ item, live, busy, actions }: { item: ItemOf<'user'>; live?: boolean; busy: boolean; actions: ChatActions }) {
  const tag = item.steer ? STEER_TAG[item.steer] : null;
  return (
    <div className={`msg user ${item.steer ? 'steer' : ''}`}>
      {tag && (
        <div className="steer-tag">
          <tag.icon size={11} /> {tag.text}
          {live && item.steer !== 'now' && (
            <button className="steer-now" onClick={() => actions.onForceSteer(item.id)} title={item.steer === 'later' ? 'Stop the agent and send this now' : "Interrupt the agent's current step so it reads this now"}>
              <Zap size={10} /> Send now
            </button>
          )}
        </div>
      )}
      {item.background && <div className="steer-tag"><Layers size={11} /> Running in the background</div>}
      {item.variants && <div className="steer-tag"><Layers size={11} /> {item.variants} variants</div>}
      {item.annotations.length > 0 && <Attachments annotations={item.annotations} />}
      {item.text && <div className="msg-text">{item.text}</div>}
      {item.text && (
        <div className="msg-actions">
          <CopyButton text={item.text} />
          <button onClick={() => actions.onEditMessage(item.text)} title="Put this back in the composer to edit and send"><Pencil size={12} /></button>
          {!busy && <button onClick={() => actions.onSendText(item.text)} title="Send it again"><RotateCw size={12} /></button>}
          <button onClick={() => actions.onSaveSnippet(item.text)} title="Save as a snippet you can reuse from the / menu"><Pin size={12} /></button>
          <button onClick={() => actions.onFork(item.id)} title="Fork: a new chat with everything before this message, ready to take another direction"><GitFork size={12} /></button>
          {!busy && <RewindButton onRewind={() => actions.onRewind(item.id)} />}
        </div>
      )}
      {item.annotations.filter((a) => a.note.trim()).map((a) => (
        <div key={a.id} className="msg-note"><span className="badge sm" style={{ background: a.color }}>{a.n}</span>{a.note}</div>
      ))}
    </div>
  );
}
