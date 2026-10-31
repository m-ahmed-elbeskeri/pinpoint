import { useState } from 'react';
import { Check, ChevronRight, ListChecks, Loader2 } from '../../ui/icons';
import type { ItemOf } from '../types';

export function PlanItem({ item, live }: { item: ItemOf<'plan'>; live: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null);
  const shown = open ?? live;
  const done = item.steps.filter((x) => x.status === 'completed').length;
  return (
    <div className={`plan-card ${live ? 'live' : ''} ${shown ? 'open' : ''}`}>
      <button className="plan-head" onClick={() => setOpen(!shown)}>
        <ListChecks size={13} /><b>Plan</b><span>{done} of {item.steps.length} done</span><ChevronRight size={12} className={`chev ${shown ? 'open' : ''}`} />
      </button>
      {shown && (
        <ol>
          {item.steps.map((x, i) => (
            <li key={i} className={x.status}>
              <i className="plan-mark">{x.status === 'completed' ? <Check size={11} /> : x.status === 'in_progress' && live ? <Loader2 size={11} className="spin" /> : null}</i>
              <span>{x.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
