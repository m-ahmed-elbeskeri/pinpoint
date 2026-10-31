import { AlertTriangle } from '../../ui/icons';
import { INTERRUPTED } from '../../../lib/chat';
import type { ChatActions, ItemOf } from '../types';

export function ErrorItem({ item, busy, actions }: { item: ItemOf<'error'>; busy: boolean; actions: ChatActions }) {
  return (
    <div className={`msg error ${item.text === INTERRUPTED ? 'soft' : ''}`}>
      <AlertTriangle size={14} /> <span>{item.text}</span>
      {item.text === INTERRUPTED && !busy && <button className="link-btn resume-btn" onClick={() => actions.onSendText('Pick up where you left off: check what is already changed, then finish the request.')}>Resume</button>}
    </div>
  );
}
