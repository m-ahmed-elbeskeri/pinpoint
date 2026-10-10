import { useState } from 'react';
import { BookOpen, Box, RotateCcw, X } from './icons';
import type { Annotation, CssRuleInfo, ForcedState } from '../lib/types';

export type ToolSection = 'tweak' | 'content' | 'component' | 'rules';

interface Props {
  ann: Annotation;
  section: ToolSection | null;
  setSection(s: ToolSection | null): void;
  classNames: string[]; // what the page's CSS defines, for autocomplete
  generated: string[];  // classes Pinpoint generated CSS for, so they already show
  isolated: boolean;
  onStates(states: ForcedState[]): void;
  onScope(scope: Annotation['scope']): void;
  onTweak(prop: string, value: string): void;
  onResetTweaks(): void;
  onText(text: string): void;
  onClasses(value: string): void;
  onProp(name: string, value: string): void;
  onIsolate(on: boolean): void;
  onStory(): void;
  onOpenFile(file: string, line?: number): void;
}

const STATES: { id: ForcedState; label: string; hint: string }[] = [
  { id: 'hover', label: ':hover', hint: 'Show the element as if the pointer were over it' },
  { id: 'focus', label: ':focus', hint: 'Show its keyboard-focus look (also forces :focus-visible)' },
  { id: 'active', label: ':active', hint: 'Show it as if it were being pressed' },
  { id: 'disabled', label: 'disabled', hint: 'Set the disabled attribute (form controls)' },
];

type Field = { prop: string; label: string; kind?: 'color' | 'weight'; step?: number; wide?: boolean };
const FIELDS: Field[] = [
  { prop: 'padding', label: 'Padding', wide: true },
  { prop: 'margin', label: 'Margin', wide: true },
  { prop: 'width', label: 'Width' },
  { prop: 'height', label: 'Height' },
  { prop: 'gap', label: 'Gap' },
  { prop: 'border-radius', label: 'Radius' },
  { prop: 'font-size', label: 'Size' },
  { prop: 'font-weight', label: 'Weight', kind: 'weight' },
  { prop: 'line-height', label: 'Line' },
  { prop: 'opacity', label: 'Opacity', step: 0.1 },
  { prop: 'color', label: 'Text', kind: 'color' },
  { prop: 'background-color', label: 'Fill', kind: 'color' },
];

// "rgb(255, 79, 58)" -> "#ff4f3a" for <input type="color">.
function toHex(v: string | undefined) {
  if (!v) return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const m = v.match(/rgba?\(([^)]+)\)/);
  if (!m) return '#000000';
  return '#' + m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((n) => Math.round(parseFloat(n)).toString(16).padStart(2, '0')).join('');
}

// Arrow keys nudge every number in the value ("8px 16px" -> "9px 17px").
function nudge(value: string, delta: number) {
  const decimals = Math.abs(delta) < 1 ? 2 : 0;
  return value.replace(/-?\d*\.?\d+/g, (n) => String(+(parseFloat(n) + delta).toFixed(decimals)));
}

const where = (r: CssRuleInfo) => (r.utility ? 'utility class' : r.file ? `${r.file.split('/').pop()}${r.line ? `:${r.approx ? '~' : ''}${r.line}` : ''}` : '');
const isFile = (r: CssRuleInfo) => !!r.file && !r.utility && !/^inline|^https?:/.test(r.file);

// Everything a picked element can be asked or made to do: forced states, scope,
// live style tweaks, copy and class edits, component props, and its CSS rules.
export function ElementTools(p: Props) {
  const { ann, section, setSection } = p;
  const el = ann.element!;
  const states = ann.states || [];
  const tweaks = ann.tweaks || {};
  const tweakCount = Object.keys(tweaks).length;
  const comp = el.component;
  const rules = el.rules || [];
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newClass, setNewClass] = useState('');

  const toggle = (s: ForcedState) => p.onStates(states.includes(s) ? states.filter((x) => x !== s) : [...states, s]);
  const commit = (prop: string, value: string) => { setDraft((d) => ({ ...d, [prop]: value })); p.onTweak(prop, value.trim()); };
  const origin = (prop: string) => rules.find((r) => r.wins.includes(prop));

  const classes = (ann.classEdit?.to ?? (el.classes || []).join(' ')).split(/\s+/).filter(Boolean);
  const addClass = () => {
    const add = newClass.split(/\s+/).filter((c) => c && !classes.includes(c));
    if (add.length) p.onClasses([...classes, ...add].join(' '));
    setNewClass('');
  };
  const contentCount = (ann.textEdit ? 1 : 0) + (ann.classEdit ? 1 : 0);
  const props = Object.entries(comp?.props || {});
  const propValue = (k: string, v: string) => ann.propEdits?.[k]?.to ?? v;

  const tabs: { id: ToolSection; label: string; show: boolean }[] = [
    { id: 'tweak', label: `Styles${tweakCount ? ` (${tweakCount})` : ''}`, show: true },
    { id: 'content', label: `Content${contentCount ? ` (${contentCount})` : ''}`, show: true },
    { id: 'component', label: `Props${ann.propEdits ? ` (${Object.keys(ann.propEdits).length})` : ''}`, show: !!comp?.name },
    { id: 'rules', label: `CSS (${rules.length})`, show: rules.length > 0 },
  ];

  return (
    <div className="el-tools">
      <div className="el-row">
        <span className="el-label">State</span>
        {STATES.map((s) => (
          <button key={s.id} className={`chip mono ${states.includes(s.id) ? 'on' : ''}`} onClick={() => toggle(s.id)} title={s.hint}>{s.label}</button>
        ))}
      </div>

      {comp?.name && (comp.uses ?? 0) > 1 && (
        <div className="el-row">
          <span className="el-label" title={comp.files?.join('\n')}>&lt;{comp.name}&gt; ×{comp.uses}</span>
          <div className="seg el-scope">
            <button className={ann.scope === 'instance' ? 'on' : ''} onClick={() => p.onScope(ann.scope === 'instance' ? undefined : 'instance')} title="Change only this one; the other uses stay as they are">This one</button>
            <button className={ann.scope === 'component' ? 'on' : ''} onClick={() => p.onScope(ann.scope === 'component' ? undefined : 'component')} title={`Change the component itself: all ${comp.uses} uses`}>All {comp.uses}</button>
          </div>
        </div>
      )}

      <div className="el-tabs">
        {tabs.filter((t) => t.show).map((t) => (
          <button key={t.id} className={section === t.id ? 'on' : ''} onClick={() => setSection(section === t.id ? null : t.id)}>{t.label}</button>
        ))}
      </div>

      {section === 'tweak' && (
        <div className="el-grid">
          {FIELDS.map((f) => {
            const current = el.styles?.[f.prop] || '';
            const value = draft[f.prop] ?? tweaks[f.prop] ?? '';
            const token = el.tokens?.[f.prop];
            const from = origin(f.prop);
            const tip = [f.prop, token && `token: ${token}`, from && `set by ${from.selector}${where(from) ? ` (${where(from)})` : ''}`].filter(Boolean).join('\n');
            return (
              <label key={f.prop} className={`el-field ${f.wide ? 'wide' : ''} ${tweaks[f.prop] ? 'set' : ''}`} title={tip}>
                <span>{f.label}</span>
                {f.kind === 'color' && (
                  <input type="color" value={toHex(tweaks[f.prop] || current)} onChange={(e) => commit(f.prop, e.target.value)} />
                )}
                {f.kind === 'weight' ? (
                  <select value={tweaks[f.prop] || ''} onChange={(e) => commit(f.prop, e.target.value)}>
                    <option value="">{current || 'auto'}</option>
                    {[300, 400, 500, 600, 700, 800].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                ) : (
                  <input
                    value={value}
                    placeholder={token || current || (f.prop === 'opacity' ? '1' : '0px')}
                    spellCheck={false}
                    onChange={(e) => commit(f.prop, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                      const base = value || current || (f.prop === 'opacity' ? '1' : '0px');
                      if (!/\d/.test(base)) return;
                      e.preventDefault();
                      const unitless = f.prop === 'line-height' && /^[\d.]+$/.test(base.trim());
                      const step = (f.step ?? (unitless ? 0.1 : 1)) * (e.shiftKey ? 10 : 1);
                      commit(f.prop, nudge(base, e.key === 'ArrowUp' ? step : -step));
                    }}
                  />
                )}
              </label>
            );
          })}
          <p className="hint el-hint">
            Changes show instantly. ↑/↓ nudges, Shift for ×10.
            {tweakCount > 0 && <button className="el-link" onClick={() => { setDraft({}); p.onResetTweaks(); }}><RotateCcw size={10} /> Reset</button>}
          </p>
        </div>
      )}

      {section === 'content' && (
        <div className="el-stack">
          {el.leaf ? (
            <label className={`el-field tall ${ann.textEdit ? 'set' : ''}`}>
              <span>Text</span>
              <input value={ann.textEdit?.to ?? el.text} onChange={(e) => p.onText(e.target.value)} spellCheck={false} />
            </label>
          ) : <p className="hint el-hint">This element contains other elements. Pick the one holding the text to edit its copy.</p>}
          <div className={`el-classes ${ann.classEdit ? 'set' : ''}`}>
            {classes.map((c) => {
              // Added here but not in the page's CSS yet: it will only take effect once the agent writes it.
              const pending = p.classNames.length > 0 && !(el.classes || []).includes(c) && !p.classNames.includes(c) && !p.generated.includes(c);
              return (
              <span key={c} className={`el-class ${pending ? 'pending' : ''}`} title={pending ? "Your CSS doesn't define this class yet, so nothing changes in the page until the agent adds it to the source" : undefined}>{c}<button onClick={() => p.onClasses(classes.filter((x) => x !== c).join(' '))} title="Remove"><X size={9} /></button></span>
              );
            })}
            <input
              list="pp-classes" value={newClass} placeholder="add class…" spellCheck={false}
              onChange={(e) => setNewClass(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addClass(); } }}
              onBlur={addClass}
            />
            <datalist id="pp-classes">
              {newClass.length >= 2 && p.classNames.filter((c) => c.includes(newClass) && !classes.includes(c)).slice(0, 40).map((c) => <option key={c} value={c} />)}
            </datalist>
          </div>
          <p className="hint el-hint">Edits show in the page. New Tailwind utilities are generated on the spot; a dashed class is one your CSS doesn't define, so it has no effect yet.</p>
        </div>
      )}

      {section === 'component' && comp?.name && (
        <div className="el-stack">
          <span className="el-label">&lt;{comp.name}&gt;</span>
          {props.length === 0 && <p className="hint el-hint">No simple props on this component.</p>}
          {props.map(([k, v]) => {
            const cur = propValue(k, v);
            const editable = /^(".*"|true|false|-?\d+(\.\d+)?)$/.test(v);
            const bool = v === 'true' || v === 'false';
            return (
              <label key={k} className={`el-field tall ${ann.propEdits?.[k] ? 'set' : ''}`} title={editable ? 'Change it to see the component re-render' : 'Not editable here'}>
                <span>{k}</span>
                {bool ? <input type="checkbox" checked={cur === 'true'} onChange={(e) => p.onProp(k, String(e.target.checked))} />
                  : <input defaultValue={cur.replace(/^"|"$/g, '')} disabled={!editable} spellCheck={false} onBlur={(e) => { if (e.target.value !== cur.replace(/^"|"$/g, '')) p.onProp(k, e.target.value); }} onKeyDown={(e) => { const v = (e.target as HTMLInputElement).value; if (e.key === 'Enter' && v !== cur.replace(/^"|"$/g, '')) p.onProp(k, v); }} />}
              </label>
            );
          })}
          <div className="el-row">
            <button className={`btn xs ${p.isolated ? 'primary' : ''}`} onClick={() => p.onIsolate(!p.isolated)} title="Hide everything else on the page"><Box size={12} /> {p.isolated ? 'Show page' : 'Isolate'}</button>
            <button className="btn xs" onClick={p.onStory} title="Open this component's Storybook story, or ask the agent to write one"><BookOpen size={12} /> Story</button>
          </div>
        </div>
      )}

      {section === 'rules' && (
        <ul className="el-rules">
          {rules.map((r, i) => (
            <li key={i}>
              <div className="el-rule-head">
                <code title={r.selector}>{r.selector}</code>
                {(r.file || r.utility) && (isFile(r)
                  ? <button className="el-link" onClick={() => p.onOpenFile(r.file!, r.line)} title={`Open ${r.file}${r.approx ? ' (line found by searching the file)' : ''}`}>{where(r)}</button>
                  : <span className="hint">{where(r)}</span>)}
              </div>
              {r.media && <small>@media {r.media}</small>}
              <div className="el-decls">
                {r.declarations.map((d, j) => (
                  <span key={j} className={r.wins.some((w) => d.name === w || d.name.startsWith(w + '-') || w.startsWith(d.name + '-')) ? 'win' : ''}>{d.name}: {d.value}{d.important ? ' !important' : ''};</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
