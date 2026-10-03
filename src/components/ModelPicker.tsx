import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Cpu } from 'lucide-react';

export interface ModelChoice { value: string; label: string; desc?: string }
export interface LevelChoice { value: string; label: string; desc?: string }

interface Props {
  model: string;
  models: ModelChoice[];
  modelLabel: string;       // what the button shows (the default's real name when nothing is picked)
  onModel(value: string): void;
  level: string;            // '' = the model's default
  levels: LevelChoice[];    // lowest first; empty when the model has no thinking levels
  defaultLevel?: string;    // which level "default" resolves to, when known
  onLevel(value: string): void;
  disabled?: boolean;
}

// Model and thinking level in one control: a compact button, and a menu with
// the model list and a slider you click or drag to set how hard it thinks.
export function ModelPicker({ model, models, modelLabel, onModel, level, levels, defaultLevel, onLevel, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  // Where the thumb sits: the chosen level, or the one "default" stands for.
  const shown = level || defaultLevel || '';
  const index = Math.max(0, levels.findIndex((l) => l.value === shown));
  const current = levels.find((l) => l.value === shown);
  const last = Math.max(1, levels.length - 1);

  const pick = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !levels.length) return;
    const i = Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * last);
    if (levels[i].value !== level) onLevel(levels[i].value);
  };
  const drag = (e: React.PointerEvent) => {
    if (disabled) return;
    const el = e.currentTarget as HTMLElement;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pick(e.clientX);
    const move = (ev: PointerEvent) => pick(ev.clientX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const nudge = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!step || !levels.length) return;
    e.preventDefault();
    onLevel(levels[Math.min(last, Math.max(0, index + step))].value);
  };

  const levelText = !levels.length ? '' : current?.label || 'Default';
  return (
    <div className="dd mp" ref={ref}>
      <button className={`dd-btn mp-btn ${open ? 'open' : ''}`} disabled={disabled} onClick={() => setOpen(!open)} title={`Model: ${modelLabel}${levels.length ? ` · Thinking: ${levelText}${level ? '' : ' (default)'}` : ''}`}>
        <Cpu size={12} />
        <span className="dd-label mp-model">{modelLabel}</span>
        {levels.length > 0 && (
          <>
            <span className="mp-meter" aria-hidden>
              {levels.map((l, i) => <i key={l.value} className={current && i <= index ? 'on' : ''} style={{ height: 4 + (i * 7) / last }} />)}
            </span>
            <span className="dd-label mp-level">{levelText}</span>
          </>
        )}
        <ChevronDown size={11} className="dd-chev" />
      </button>

      {open && (
        <div className="dd-menu left mp-menu">
          <div className="dd-title">Model</div>
          <div className="mp-models">
            {models.map((m) => (
              <button key={m.value || 'default'} className={`dd-item ${m.value === model ? 'sel' : ''}`} onClick={() => onModel(m.value)}>
                <span className="dd-item-text"><span>{m.label}</span>{m.desc && <small>{m.desc}</small>}</span>
                {m.value === model && <Check size={13} className="dd-check" />}
              </button>
            ))}
          </div>

          <div className="dd-title mp-level-title">
            Thinking level
            {levels.length > 0 && (level
              ? <button className="mp-reset" onClick={() => onLevel('')} title="Let the model use its default level">Use default</button>
              : <span className="mp-auto">default</span>)}
          </div>
          {levels.length === 0 ? <p className="mp-none">This model has no thinking levels.</p> : (
            <div className="mp-slider">
              <div
                className="mp-track" ref={track} role="slider" tabIndex={0}
                aria-valuemin={0} aria-valuemax={last} aria-valuenow={index} aria-valuetext={levelText}
                onPointerDown={drag} onKeyDown={nudge}
              >
                <div className="mp-fill" style={{ width: current ? `${(index / last) * 100}%` : 0 }} />
                {levels.map((l, i) => <span key={l.value} className={`mp-stop ${current && i <= index ? 'on' : ''}`} style={{ left: `${(i / last) * 100}%` }} />)}
                {(level || current) && <div className={`mp-thumb ${level ? '' : 'auto'}`} style={{ left: `${(index / last) * 100}%` }} />}
              </div>
              <div className="mp-ends"><span>{levels[0].label}</span><span>{levels[levels.length - 1].label}</span></div>
              <div className="mp-current">
                <b>{levelText}{!level && current ? ' (default)' : ''}</b>
                <span>{current?.desc || "The model's own default. Click or drag to choose a level."}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
