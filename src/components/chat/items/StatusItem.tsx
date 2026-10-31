import type { ItemOf } from '../types';

export function StatusItem({ item }: { item: ItemOf<'status'> }) {
  return <div className="msg status">{item.text}</div>;
}
