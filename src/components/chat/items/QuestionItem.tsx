import { useEffect, useState } from 'react';
import { ArrowUp, Check } from '../../ui/icons';
import type { ChatItem } from '../../../types';
import type { ChatActions } from '../types';

const typing = (el: Element | null) => !!el && el.matches('input, textarea, select, [contenteditable="true"]') && !(el.matches('.composer-box textarea') && !(el as HTMLTextAreaElement).value);

// A question from the agent with options to pick. Its run waits until you answer.
export function QuestionItem({ item, actions }: { item: Extract<ChatItem, { kind: 'question' }>; actions: ChatActions }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const open = item.status === 'pending';
  const answer = (value: string) => { if (value.trim()) actions.onAnswer(item.id, value.trim()); };
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));
  const choose = (label: string) => (item.multi ? toggle(label) : answer(label));

  // 1–9 pick an option, unless you're typing somewhere (an empty composer doesn't count).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !/^[1-9]$/.test(e.key) || typing(document.activeElement)) return;
      const o = item.options[Number(e.key) - 1];
      if (!o) return;
      e.preventDefault();
      choose(o.label);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`question-card ${item.status}`}>
      <div className="question-text">{item.question}</div>
      {open ? (
        <>
          <div className="question-options">
            {item.options.map((o, i) => (
              <button key={o.label} className={item.multi && picked.includes(o.label) ? 'on' : ''} title={o.description} onClick={() => choose(o.label)}>
                {item.multi && <span className="question-box">{picked.includes(o.label) && <Check size={11} />}</span>}
                <span className="question-label">{o.label}{o.description && <small>{o.description}</small>}</span>
                {i < 9 && <kbd className="question-key">{i + 1}</kbd>}
              </button>
            ))}
          </div>
          {!item.multi && <p className="question-hint">Or type your own answer in the box below</p>}
          {item.multi && <form className="question-other" onSubmit={(e) => { e.preventDefault(); answer([...picked, other].filter((x) => x.trim()).join(', ')); }}>
            <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Anything else (optional)" />
            {(other.trim() || picked.length > 0) && <button className="btn xs primary" title="Send"><ArrowUp size={12} /></button>}
          </form>}
        </>
      ) : (
        <div className="question-answer">{item.status === 'answered' ? <><Check size={12} /> {item.answer}</> : 'Not answered'}</div>
      )}
    </div>
  );
}
