import { Markdown } from '../Markdown';
import type { ItemOf } from '../types';
import { CopyButton } from './CopyButton';

export function TextItem({ item }: { item: ItemOf<'text'> }) {
  return (
    <div className={`msg agent ${item.streaming ? 'streaming' : ''}`}>
      <Markdown text={item.text} />
      {!item.streaming && <div className="msg-actions"><CopyButton text={item.text} /></div>}
    </div>
  );
}
