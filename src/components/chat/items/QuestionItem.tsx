import { useState } from 'react';
import { ArrowUp, Check } from '../../ui/icons';
import type { ChatItem } from '../../../types';
import type { ChatActions } from '../types';

// A question from the agent with options to pick. Its run waits until you answer.
export function QuestionItem({ item, actions }: { item: Extract<ChatItem, { kind: 'question' }>; actions: ChatActions }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const open = item.status === 'pending';
  const answer = (value: string) => { if (value.trim()) actions.onAnswer(item.id, value.trim()); };
  const toggle = (o: string) => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]));

  return (
    <div className={`question-card ${item.status}`}>
      <div className="question-text">{item.question}</div>
      {open ? (
        <>
          <div className="question-options">
            {item.options.map((o) => (
              <button key={o.label} className={item.multi && picked.includes(o.label) ? 'on' : ''} title={o.description} onClick={() => (item.multi ? toggle(o.label) : answer(o.label))}>
                {item.multi && <span className="question-box">{picked.includes(o.label) && <Check size={11} />}</span>}
                <span className="question-label">{o.label}{o.description && <small>{o.description}</small>}</span>
              </button>
            ))}
          </div>
          <form className="question-other" onSubmit={(e) => { e.preventDefault(); answer(item.multi && picked.length ? [...picked, other].filter((x) => x.trim()).join(', ') : other); }}>
            <input value={other} onChange={(e) => setOther(e.target.value)} placeholder={item.multi ? 'Anything else (optional)' : 'Or type your own answer'} />
            {(other.trim() || (item.multi && picked.length > 0)) && <button className="btn xs primary" title="Send"><ArrowUp size={12} /></button>}
          </form>
        </>
      ) : (
        <div className="question-answer">{item.status === 'answered' ? <><Check size={12} /> {item.answer}</> : 'Not answered'}</div>
      )}
    </div>
  );
}
