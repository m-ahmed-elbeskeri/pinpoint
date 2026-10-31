import { useState } from 'react';
import { Check, ClipboardCopy } from '../../ui/icons';

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }} title="Copy">
      {done ? <Check size={12} /> : <ClipboardCopy size={12} />}
    </button>
  );
}
