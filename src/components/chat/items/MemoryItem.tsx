import { Check, Lightbulb } from '../../ui/icons';
import type { ChatActions, ItemOf } from '../types';

export function MemoryItem({ item, actions }: { item: ItemOf<'memory'>; actions: ChatActions }) {
  return (
    <div className={`memory-card ${item.status}`}>
      <Lightbulb size={14} />
      <div className="memory-text">
        <small>{item.status === 'saved' ? 'Saved to project memory' : item.status === 'dismissed' ? 'Not remembered' : 'Remember for this project?'}</small>
        <span>{item.text}</span>
      </div>
      {item.status === 'pending' ? (
        <>
          <button className="btn xs primary" onClick={() => actions.onMemory(item.id, 'save')}><Check size={12} /> Save</button>
          <button className="btn xs ghost" onClick={() => actions.onMemory(item.id, 'dismiss')}>Dismiss</button>
        </>
      ) : null}
    </div>
  );
}
