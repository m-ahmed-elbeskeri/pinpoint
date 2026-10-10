import { ArrowUpRight, Circle, Eraser, Highlighter, Pencil, Plus, Redo2, Square, Trash2, Type, Undo2 } from './icons';
import type { Tool } from '../lib/types';
import { COLORS } from '../lib/draw';

const MOD = window.pinpoint.platform === 'darwin' ? '⌘' : 'Ctrl';

const TOOLS: { id: Tool; icon: typeof Pencil; label: string; key: string }[] = [
  { id: 'pen', icon: Pencil, label: 'Pen', key: 'P' },
  { id: 'highlighter', icon: Highlighter, label: 'Highlighter', key: 'H' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow', key: 'A' },
  { id: 'rect', icon: Square, label: 'Box', key: 'R' },
  { id: 'ellipse', icon: Circle, label: 'Circle', key: 'O' },
  { id: 'text', icon: Type, label: 'Text', key: 'T' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', key: 'E' },
];
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(TOOLS.map((t) => [t.key.toLowerCase(), t.id]));

const SIZES = [2, 4, 7];

interface Props {
  tool: Tool; setTool(t: Tool): void;
  color: string; setColor(c: string): void;
  size: number; setSize(s: number): void;
  canUndo: boolean; canRedo: boolean;
  onUndo(): void; onRedo(): void; onClear(): void;
  onCommit(): void; commitLabel: string; count: number;
}

export function DrawToolbar(p: Props) {
  return (
    <div className="draw-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <div className="dt-group">
        {TOOLS.map((t) => (
          <button key={t.id} className={`icon-btn ${p.tool === t.id ? 'on' : ''}`} title={`${t.label} (${t.key})`} onClick={() => p.setTool(t.id)}>
            <t.icon size={16} />
          </button>
        ))}
      </div>
      <div className="dt-sep" />
      <div className="dt-group">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${p.color === c ? 'on' : ''}`} style={{ ['--c' as string]: c }} title={c} onClick={() => p.setColor(c)} />
        ))}
      </div>
      <div className="dt-sep" />
      <div className="dt-group">
        {SIZES.map((s) => (
          <button key={s} className={`icon-btn ${p.size === s ? 'on' : ''}`} title={`Stroke ${s}`} onClick={() => p.setSize(s)}>
            <span className="dot" style={{ width: s + 3, height: s + 3 }} />
          </button>
        ))}
      </div>
      <div className="dt-sep" />
      <div className="dt-group">
        <button className="icon-btn" title={`Undo (${MOD}+Z)`} disabled={!p.canUndo} onClick={p.onUndo}><Undo2 size={16} /></button>
        <button className="icon-btn" title={`Redo (${MOD}+Shift+Z)`} disabled={!p.canRedo} onClick={p.onRedo}><Redo2 size={16} /></button>
        <button className="icon-btn" title="Clear" disabled={!p.count} onClick={p.onClear}><Trash2 size={16} /></button>
      </div>
      <button className="btn primary sm" disabled={!p.count} onClick={p.onCommit}>
        <Plus size={14} /> {p.commitLabel}
      </button>
    </div>
  );
}
