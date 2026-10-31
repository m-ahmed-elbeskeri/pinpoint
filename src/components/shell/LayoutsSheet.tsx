import { useState } from 'react';
import { Plus, Trash2, X } from '../ui/icons';
import type { SavedLayout } from '../../types';
import { useEscape } from '../../lib/hooks';

export function LayoutsSheet({ layouts, onSave, onApply, onRemove, onClose }: { layouts: SavedLayout[]; onSave(name: string): void; onApply(l: SavedLayout): void; onRemove(name: string): void; onClose(): void }) {
  const [name, setName] = useState('');
  useEscape((e) => { e.preventDefault(); onClose(); });
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal layouts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Layouts</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <form className="mem-add" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onSave(name.trim()); setName(''); } }}>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name the current layout" />
          <button className="btn xs primary" disabled={!name.trim()}><Plus size={12} /> Save</button>
        </form>
        {layouts.length > 0 && (
          <div className="layout-list">
            {layouts.map((l) => (
              <div key={l.name} className="layout-row">
                <button onClick={() => onApply(l)}>{l.name}</button>
                <button className="icon-btn xs" onClick={() => onRemove(l.name)} title="Delete"><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
