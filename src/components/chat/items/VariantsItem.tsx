import { useEffect, useState } from 'react';
import { Check, Columns2, Layers } from '../../ui/icons';
import type { ChatActions, ItemOf } from '../types';

function VariantPicker({ item, busy, onPick, onCompare, onLive }: {
  item: ItemOf<'variants'>; busy: boolean;
  onPick(runId: string): void; onCompare(runId: string): void; onLive(): void;
}) {
  const [shots, setShots] = useState<Record<string, string | undefined>>({});
  useEffect(() => {
    let live = true;
    for (const o of item.options) {
      window.pinpoint.runShots(o.runId, ['after']).then((s) => { if (live) setShots((prev) => ({ ...prev, [o.runId]: s.after })); }).catch(() => {});
    }
    return () => { live = false; };
  }, [item.options]);
  return (
    <div className="variants-card">
      <div className="variants-head"><Layers size={14} /> {item.chosen ? 'Variant applied' : `Pick one of ${item.options.length} variants`}<span className="hint">{item.chosen ? 'You can still switch.' : 'Nothing is applied until you choose.'}</span></div>
      <div className="variants-grid">
        {item.options.map((o) => (
          <figure key={o.runId} className={item.chosen === o.runId ? 'chosen' : ''}>
            <button className="variant-shot" onClick={() => onCompare(o.runId)} title="Compare with before">
              {shots[o.runId] ? <img src={shots[o.runId]} alt={`Variant ${o.index}`} /> : <span className="hint">No screenshot</span>}
            </button>
            <figcaption>
              <b>Variant {o.index}</b><small>{o.files} file{o.files > 1 ? 's' : ''}</small>
              <div className="spacer" />
              {item.chosen === o.runId
                ? <span className="df-tag"><Check size={11} /> Applied</span>
                : <button className="btn xs primary" disabled={busy} onClick={() => onPick(o.runId)}>Use this</button>}
            </figcaption>
          </figure>
        ))}
      </div>
      <button className="btn xs variants-live-btn" disabled={busy} onClick={onLive} title="Run each variant in its own copy of the project and show them next to each other, live"><Columns2 size={12} /> See them live, side by side</button>
    </div>
  );
}

export function VariantsItem({ item, busy, actions }: { item: ItemOf<'variants'>; busy: boolean; actions: ChatActions }) {
  return <VariantPicker item={item} busy={busy} onPick={(runId) => actions.onPickVariant(item.id, runId)} onCompare={(runId) => actions.onCompare(runId)} onLive={() => actions.onVariantsLive(item.id)} />;
}
