import { useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from '../ui/icons';
import type { AgentId, HarnessInfo } from '../../types';
import { AgentIcon } from './AgentIcon';
import { useDismiss } from '../../lib/hooks';

interface Props {
  value: AgentId;
  harnesses: HarnessInfo[];
  agents: Record<string, { ok: boolean; version?: string }> | null;
  disabled?: boolean;
  onPick(id: AgentId): void;
  onSetup(): void;
  mcp?: { name: string; status: string }[];
}

export function AgentPicker({ value, harnesses, agents, disabled, onPick, onSetup, mcp = [] }: Props) {
  const [open, setOpen] = useState(false);
  const [showMissing, setShowMissing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = harnesses.find((h) => h.id === value);
  const ok = (id: string) => !agents || !!agents[id]?.ok;

  useDismiss(open, () => setOpen(false), { ref });

  const installed = harnesses.filter((h) => ok(h.id));
  const missing = harnesses.filter((h) => !ok(h.id));
  const row = (h: HarnessInfo) => (
    <button key={h.id} className={`dd-item ${h.id === value ? 'sel' : ''}`} onClick={() => { onPick(h.id); setOpen(false); }}>
      <AgentIcon id={h.id} name={h.name} size={16} />
      <span className="dd-item-text">
        <span>{h.name}</span>
        <small>{agents?.[h.id]?.ok ? agents[h.id].version : agents ? `${h.bin} not found` : h.bin}{h.steerable ? ' · steerable' : ''}</small>
      </span>
      {h.id === value && <Check size={14} className="dd-check" />}
    </button>
  );

  return (
    <div className="dd agent-seg agent-picker" ref={ref}>
      <button
        className={`on ${ok(value) ? '' : 'missing'}`} onClick={() => setOpen(!open)} disabled={disabled}
        title={`${current?.name || value}${ok(value) ? (agents?.[value]?.version ? ` · ${agents[value].version}` : '') : ": its CLI wasn't found. Install it or set its path in Settings."} (click to switch agent)`}
      >
        <AgentIcon id={value} name={current?.name || value} />
        <span>{current?.name || value}</span>
        <ChevronDown size={12} className="dd-chev" />
      </button>
      {open && (
        <div className="dd-menu left agent-menu">
          <div className="dd-title">Agents</div>
          {installed.map(row)}
          {missing.length > 0 && (showMissing
            ? <><div className="dd-title">Not installed</div>{missing.map(row)}</>
            : <button className="dd-item more-row" onClick={() => setShowMissing(true)}><span className="agent-icon letter more-icon" aria-hidden="true">+</span><span className="dd-item-text"><span>{missing.length} more agents</span><small>Not installed: {missing.slice(0, 3).map((h) => h.name).join(', ')}{missing.length > 3 ? '…' : ''}</small></span></button>)}
          {mcp.length > 0 && (
            <>
              <div className="dd-title">MCP servers</div>
              {mcp.map((s) => (
                <div key={s.name} className="mcp-row" title={`${s.name}: ${s.status}`}>
                  <span>{s.name}</span><small className={s.status === 'connected' ? 'ok' : 'bad'}>{s.status}</small>
                </div>
              ))}
            </>
          )}
          <div className="dd-sep" />
          <button className="dd-item" onClick={() => { setOpen(false); onSetup(); }}>
            <Plus size={14} className="dd-item-icon" />
            <span className="dd-item-text"><span>Add or set up agents…</span></span>
          </button>
        </div>
      )}
    </div>
  );
}
