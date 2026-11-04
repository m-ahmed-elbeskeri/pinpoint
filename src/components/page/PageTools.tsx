import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FlaskConical, Layers, Loader2, MessageSquare, Pause, Pin as PinIcon, Share2, StepForward, Trash2, Upload, X } from '../ui/icons';
import type { NetworkMode, PageEnv, Pin } from '../../types';
import { errText } from '../../lib/util';
import type { FocusReport, RenderReport } from '../../lib/probes';
import { useDismiss, useEscape } from '../../lib/hooks';

export interface Conditions { stress: string[]; network: NetworkMode; anim: number; vision: string; focus: boolean; renders: boolean }
export const NO_CONDITIONS: Conditions = { stress: [], network: 'normal', anim: 1, vision: '', focus: false, renders: false };

export const VISION: { id: string; label: string; hint: string }[] = [
  { id: '', label: 'Normal', hint: 'Full color vision' },
  { id: 'deuteranopia', label: 'Green-blind', hint: 'Deuteranopia: red and green look alike (the most common, about 1 in 16 men)' },
  { id: 'protanopia', label: 'Red-blind', hint: 'Protanopia: red looks dark, red and green look alike' },
  { id: 'tritanopia', label: 'Blue-blind', hint: 'Tritanopia: blue and green, yellow and pink look alike' },
  { id: 'achromatopsia', label: 'No color', hint: 'Achromatopsia: no color at all, only lightness' },
  { id: 'blurredVision', label: 'Blurry', hint: 'Blurred vision: like someone without their glasses' },
  { id: 'reducedContrast', label: 'Low contrast', hint: 'Reduced contrast: aging eyes, or a phone in sunlight' },
];

const STRESS: { id: string; label: string; hint: string }[] = [
  { id: 'long', label: 'Long text', hint: 'All text three times as long' },
  { id: 'pseudo', label: 'Translated-length text', hint: 'Accented and longer, like German' },
  { id: 'rtl', label: 'Right-to-left', hint: 'Laid out as for Arabic or Hebrew' },
  { id: 'empty', label: 'Empty lists', hint: 'Lists and tables with nothing in them' },
];
const NETWORK: { id: NetworkMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'Your real network and API' },
  { id: 'slow', label: 'Slow', hint: 'Slow 3G: 400 ms delay, 50 kB/s' },
  { id: 'hang', label: 'Stuck', hint: 'API requests never answer: the page stays in its loading state' },
  { id: 'error', label: 'Failing', hint: 'API requests fail with 500: the page shows its error state' },
  { id: 'offline', label: 'Offline', hint: 'No network at all' },
];
const SPEEDS = [{ rate: 1, label: '100%' }, { rate: 0.25, label: '25%' }, { rate: 0.1, label: '10%' }];

export function describeConditions(c: Conditions) {
  return [
    ...c.stress.map((s) => STRESS.find((x) => x.id === s)?.label.toLowerCase() || s),
    c.network !== 'normal' ? `network: ${NETWORK.find((n) => n.id === c.network)?.hint}` : '',
    c.anim !== 1 ? (c.anim === 0 ? 'animations paused' : `animations at ${c.anim * 100}% speed`) : '',
    c.vision ? `seen with simulated ${VISION.find((v) => v.id === c.vision)?.hint.split(':')[0].toLowerCase() || c.vision}: the page has to stay usable for someone who sees it this way, so don't rely on color alone, and keep enough contrast` : '',
  ].filter(Boolean) as string[];
}

/** How many test conditions and overlays are on, for the badge on the button. */
export const conditionCount = (c: Conditions) => describeConditions(c).length + (c.focus ? 1 : 0) + (c.renders ? 1 : 0);

interface ConditionsProps {
  value: Conditions; set(next: Conditions): void; onStep(): void;
  env: PageEnv; setEnv(next: PageEnv): void;
  layout: boolean; setLayout(on: boolean): void;
  focusReport: FocusReport | null; renderReport: RenderReport | null;
  onAskFocus(): void; onAskRenders(): void; onResetRenders(): void;
}

function CondRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="cond-item">
      <div className="cond-label"><b>{label}</b>{hint && <small>{hint}</small>}</div>
      {children}
    </div>
  );
}
function Heading({ n, children }: { n: number; children: React.ReactNode }) {
  return <h5>{children}{n > 0 && <i className="cond-n">{n} on</i>}</h5>;
}
function CondSwitch({ label, hint, title, on, set }: { label: string; hint?: React.ReactNode; title?: string; on: boolean; set(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`cond-item cond-toggle ${on ? 'on' : ''}`} onClick={() => set(!on)} title={title}>
      <span className="cond-label"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <i className="cond-knob" />
    </button>
  );
}
function CondSeg<T>({ options, value, set, wrap }: { options: { id: T; label: React.ReactNode; hint?: string }[]; value: T; set(v: T): void; wrap?: boolean }) {
  return (
    <div className={`cond-seg ${wrap ? 'wrap' : ''}`} role="radiogroup">
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => set(o.id)} title={o.hint}>{o.label}</button>
      ))}
    </div>
  );
}

function FocusSummary({ report, onAsk }: { report: FocusReport | null; onAsk(): void }) {
  const [open, setOpen] = useState<string[]>([]);
  if (!report) return <p className="cond-note">Looking at the page…</p>;
  return (
    <div className="cond-report">
      <div className="cond-report-head">
        <span>{report.count} Tab stop{report.count === 1 ? '' : 's'} · {report.issues.length ? <em>{report.issues.length} issue{report.issues.length === 1 ? '' : 's'}</em> : 'no issues'}</span>
        {report.issues.length > 0 && <button type="button" className="btn xs" onClick={onAsk}>Ask to fix</button>}
      </div>
      {report.issues.map((i) => <div key={i.kind} className="cond-issue" title={i.items.join('\n')}><b>{i.text}</b>{i.items[0] && (open.includes(i.kind) || i.items.length === 1
        ? i.items.map((it) => <small key={it} className="mono">{it}</small>)
        : <small className="mono">{i.items[0]} <button type="button" className="cond-more" onClick={() => setOpen([...open, i.kind])}>+{i.items.length - 1} more</button></small>)}</div>)}
    </div>
  );
}

function RenderSummary({ report, onAsk, onReset }: { report: RenderReport | null; onAsk(): void; onReset(): void }) {
  if (!report) return <p className="cond-note">Watching the page…</p>;
  const busy = report.components.filter((c) => c.count >= 3);
  const problems = busy.some((c) => c.same || c.identity.length) || report.slow.length > 0 || report.shifts.length > 0;
  return (
    <div className="cond-report">
      <div className="cond-report-head">
        <span>Last {report.seconds}s{problems && <> · <em>needs a look</em></>}</span>
        <button type="button" className="btn xs ghost" onClick={onReset}>Start over</button>
        {problems && <button type="button" className="btn xs" onClick={onAsk}>Ask to fix</button>}
      </div>
      <p className="cond-note">{report.react ? 'Use the page: components flash green, then amber, then red as they keep rendering.' : 'No React here, so only slow interactions and layout shifts are watched.'}</p>
      {busy.slice(0, 5).map((c) => (
        <div key={c.name} className="cond-issue" title={c.file || ''}>
          <b>&lt;{c.name}&gt; rendered {c.count}×</b>
          {(c.same > 0 || c.identity.length > 0) && <small>{c.same > 0 ? `${c.same} with nothing changed` : ''}{c.same > 0 && c.identity.length ? ' · ' : ''}{c.identity.length ? `new ${c.identity.join(', ')} each time` : ''}</small>}
        </div>
      ))}
      {report.slow.slice(-3).map((s, i) => <div key={`s${i}`} className="cond-issue warn"><b>{s.name} took {s.ms} ms</b><small className="mono">{s.target}</small></div>)}
      {report.shifts.slice(-2).map((s, i) => <div key={`l${i}`} className="cond-issue warn"><b>Layout shift {s.value}</b>{s.nodes[0] && <small className="mono">{s.nodes[0]}</small>}</div>)}
    </div>
  );
}

export function ConditionsMenu({ value, set, onStep, env, setEnv, layout, setLayout, focusReport, renderReport, onAskFocus, onAskRenders, onResetRenders }: ConditionsProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEscape(() => setOpen(false), open);
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = e.currentTarget.parentElement!.getBoundingClientRect();
    const dx = e.clientX - box.left, dy = e.clientY - box.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPos({
      x: Math.max(0, Math.min(window.innerWidth - box.width, ev.clientX - dx)),
      y: Math.max(0, Math.min(window.innerHeight - 60, ev.clientY - dy)),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const count = conditionCount(value) + (env.colorScheme ? 1 : 0) + (env.reducedMotion ? 1 : 0);
  const toggle = (id: string) => set({ ...value, stress: value.stress.includes(id) ? value.stress.filter((s) => s !== id) : [...value.stress, id] });
  const reset = () => { set(NO_CONDITIONS); setEnv({ colorScheme: null, reducedMotion: false }); };
  const net = NETWORK.find((n) => n.id === value.network)!;
  const active = [
    env.colorScheme && `${env.colorScheme[0].toUpperCase()}${env.colorScheme.slice(1)} theme`,
    value.vision && VISION.find((v) => v.id === value.vision)?.label,
    env.reducedMotion && 'Reduced motion',
    ...value.stress.map((s) => STRESS.find((x) => x.id === s)?.label),
    value.network !== 'normal' && `${net.label} network`,
    value.anim !== 1 && (value.anim ? `Animations ${value.anim * 100}%` : 'Animations paused'),
    value.focus && 'Keyboard order', value.renders && 'Render activity',
  ].filter(Boolean) as string[];

  return (
    <div className="cond-wrap">
      <button type="button" className={count ? 'on' : ''} onClick={() => setOpen(!open)} title="Test conditions: theme, motion, awkward content, slow or failing data, animation speed">
        <FlaskConical size={14} />{count > 0 && <i className="cond-count">{count}</i>}
      </button>
      {open && createPortal(
        <div className={`cond-pop ${count ? 'changed' : ''}`} style={pos ? { left: pos.x, top: pos.y, right: 'auto' } : undefined}>
          <div className="cond-head" onPointerDown={startDrag} title="Drag to move">
            <div><b>Test conditions</b><small title={active.join(', ')}>{count ? active.join(' · ') : 'The page as it normally is'}</small></div>
            <button type="button" className="cond-reset" disabled={!count} onClick={reset} title="Put everything back to normal">Reset all</button>
            <button type="button" className="cond-close" onClick={() => setOpen(false)} title="Close (Esc)"><X size={14} /></button>
          </div>

          <section>
            <Heading n={(env.colorScheme ? 1 : 0) + (value.vision ? 1 : 0) + (env.reducedMotion ? 1 : 0)}>How it's seen</Heading>
            <CondRow label="Theme">
              <CondSeg options={[{ id: null, label: 'System' }, { id: 'light' as const, label: 'Light' }, { id: 'dark' as const, label: 'Dark' }]} value={env.colorScheme} set={(colorScheme) => setEnv({ ...env, colorScheme })} />
            </CondRow>
            <CondRow label="Vision" hint={value.vision ? VISION.find((v) => v.id === value.vision)?.hint.split(': ')[1] : undefined}>
              <select className={`cond-select ${value.vision ? 'on' : ''}`} value={value.vision} onChange={(e) => set({ ...value, vision: e.target.value })} aria-label="Simulated vision">
                {VISION.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </CondRow>
            <CondSwitch label="Reduced motion" hint="As if animations are off in the OS" on={env.reducedMotion} set={(reducedMotion) => setEnv({ ...env, reducedMotion })} />
          </section>

          <section>
            <Heading n={value.stress.length}>Awkward content</Heading>
            {STRESS.map((s) => <CondSwitch key={s.id} label={s.label} hint={s.hint} on={value.stress.includes(s.id)} set={() => toggle(s.id)} />)}
          </section>

          <section>
            <Heading n={value.network !== 'normal' ? 1 : 0}>Network</Heading>
            <CondSeg options={NETWORK} value={value.network} set={(network) => set({ ...value, network })} />
            <p className="cond-note">{net.hint}.{value.network !== 'normal' ? ' Page reloads to apply.' : ''}</p>
          </section>

          <section>
            <Heading n={value.anim !== 1 ? 1 : 0}>Animation speed</Heading>
            <div className="cond-anim">
              <CondSeg
                options={[...SPEEDS.map((sp) => ({ id: sp.rate, label: sp.label })), { id: 0, label: <><Pause size={11} /> Pause</>, hint: 'Hold every animation and transition where it is' }]}
                value={value.anim} set={(anim) => set({ ...value, anim })}
              />
              {value.anim === 0 && (
                <button type="button" className="cond-step" onClick={onStep} title="Move every animation on by about a tenth of a second">
                  <StepForward size={12} /> Step
                </button>
              )}
            </div>
          </section>

          <section>
            <Heading n={(value.focus ? 1 : 0) + (value.renders ? 1 : 0) + (layout ? 1 : 0)}>Inspect</Heading>
            <div className={`cond-block ${value.focus ? 'on' : ''}`}>
            <CondSwitch label="Keyboard order" hint="Number each Tab stop and flag problems" on={value.focus} set={(focus) => set({ ...value, focus })} />
            {value.focus && <FocusSummary report={focusReport} onAsk={onAskFocus} />}
            </div>
            <div className={`cond-block ${value.renders ? 'on' : ''}`}>
            <CondSwitch label="Render activity" hint="Flash re-renders, catch slow clicks and jumps" on={value.renders} set={(renders) => set({ ...value, renders })} />
            {value.renders && <RenderSummary report={renderReport} onAsk={onAskRenders} onReset={onResetRenders} />}
            </div>
            <CondSwitch label="Layout guides" hint={<>Hold <kbd>Alt</kbd> while selecting to measure</>} on={layout} set={setLayout} />
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}

export const MAX_VARIANTS = 8;
const QUICK_VARIANTS = [0, 2, 3, 4];

export function VariantsMenu({ value, set }: { value: number; set(n: number): void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { ref });
  useEffect(() => { if (open) setText(value >= 2 ? String(value) : ''); }, [open, value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw));
    if (raw.trim() === '' || Number.isNaN(n)) return;
    set(n < 2 ? 0 : Math.min(MAX_VARIANTS, n));
  };
  const on = value >= 2;

  return (
    <div className="git-wrap" ref={ref}>
      <button className={`icon-btn variants-btn ${on ? 'on' : ''}`} onClick={() => setOpen(!open)} title={on ? `Variants: each request is tried ${value} ways, then you pick one` : 'Variants: try each request several ways and pick one'}>
        <Layers size={15} />{on && <b>{value}</b>}
      </button>
      {open && (
        <div className="git-pop variants-pop">
          <div className="git-head">
            <Layers size={14} /><b>Variants</b><span className="hint">{on ? `${value} per request` : 'off'}</span>
            <div className="spacer" />
            <button className="icon-btn xs" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          <div className="git-body">
            <div className="variants-row">
              {QUICK_VARIANTS.map((n) => (
                <button key={n} className={`chip ${(on ? value : 0) === n ? 'on' : ''}`} onClick={() => set(n)}>{n || 'Off'}</button>
              ))}
              <label className="variants-num" title={`Any number from 2 to ${MAX_VARIANTS}`}>
                <input
                  type="number" min={2} max={MAX_VARIANTS} step={1} value={text} placeholder="#" autoFocus
                  onChange={(e) => { setText(e.target.value); commit(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') setOpen(false); }}
                />
                ways
              </label>
            </div>
            <p className="git-note small">
              {on
                ? `Each request runs ${value} times, one after another from the same starting point. You pick one from the screenshots; the rest are discarded. It takes and costs about ${value}× a normal run.`
                : 'Off: each request runs once. Turn it on to see a request done several different ways and pick the one you like.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

interface PinsProps {
  projectDir: string;
  url: string; title: string;
  onCompare(images: { before: string; after: string }, title: string): void;
  flash(msg: string): void;
}

export function PinsChip({ projectDir, url, title, onCompare, flash }: PinsProps) {
  const [pins, setPins] = useState<Pin[]>([]);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { ref });
  useEffect(() => { window.pinpoint.listPins().then(setPins).catch(() => setPins([])); }, [projectDir]);

  const act = async (what: string, fn: () => Promise<Pin[]>) => {
    setWorking(what);
    try { setPins(await fn()); } catch (e) { flash(errText(e)); } finally { setWorking(null); }
  };
  const changed = pins.filter((p) => p.changed).length;
  const canPin = /^https?:/.test(url) && !pins.some((p) => p.url === url);
  const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

  return (
    <div className="git-wrap" ref={ref}>
      <button className={`chip ${changed ? 'warn' : pins.length ? '' : 'muted'}`} onClick={() => setOpen(!open)} title={changed ? `${changed} pinned page${changed > 1 ? 's' : ''} changed` : pins.length ? `${pins.length} pinned page${pins.length > 1 ? 's' : ''}: baselines that should not change` : 'Pin this page: keep a screenshot as a baseline that should not change'}>
        <PinIcon size={12} />{changed || pins.length ? ` ${changed || pins.length}` : ''}
      </button>
      {open && (
        <div className="git-pop">
          <div className="git-head">
            <PinIcon size={14} /><b>Pinned pages</b><span className="hint">should not change</span>
            <div className="spacer" />
            <button className="icon-btn xs" onClick={() => setOpen(false)}><X size={13} /></button>
          </div>
          <div className="git-body">
            {pins.length === 0 && <p className="git-note">Pin a page to keep a screenshot of it as a baseline. Check your pins any time to see whether those pages still look the same.</p>}
            {pins.length > 0 && (
              <ul className="pin-list">
                {pins.map((p) => (
                  <li key={p.id} className={p.changed ? 'changed' : ''}>
                    <span className="mono" title={p.url}>{path(p.url)}</span>
                    {p.error ? <small className="err">{p.error}</small>
                      : p.changed ? (
                        <>
                          <button className="chip warn mono" title={`${p.areas?.length ? `Changed: ${p.areas.join(', ')}\n` : ''}Click to compare with the baseline`} onClick={async () => {
                            const im = await window.pinpoint.pinImages(p.id);
                            if (im.before && im.after) onCompare({ before: im.before, after: im.after }, `Pinned: ${path(p.url)}`);
                          }}>{p.pct}%</button>
                          <button className="mini-btn" title="This change was intended: make it the new baseline" onClick={() => act('accept', () => window.pinpoint.acceptPin(p.id))}><Check size={11} /></button>
                        </>
                      ) : <small>same</small>}
                    <button className="mini-btn" title="Unpin" onClick={() => act('remove', () => window.pinpoint.removePin(p.id))}><Trash2 size={11} /></button>
                  </li>
                ))}
              </ul>
            )}
            <div className="git-actions">
              <button className="btn xs" disabled={!canPin || !!working} onClick={() => act('add', () => window.pinpoint.addPin({ url, label: title || url }))} title={canPin ? 'Save how this page looks now as its baseline' : 'Open a page served over http to pin it'}>
                {working === 'add' ? <Loader2 size={12} className="spin" /> : <PinIcon size={12} />} Pin this page
              </button>
              <div className="spacer" />
              <button className="btn xs primary" disabled={!pins.length || !!working} onClick={() => act('check', () => window.pinpoint.checkPins())}>
                {working === 'check' ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Check all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface HandoffProps {
  hasRequest: boolean;
  canIssue: boolean;
  onExport(): void; onCopy(): void; onIssue(): void; onImport(): void; onReview(): void;
  reviewCount: number; reviewing: boolean;
}

export function HandoffMenu({ hasRequest, canIssue, onExport, onCopy, onIssue, onImport, onReview, reviewCount, reviewing }: HandoffProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), { ref });
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="git-wrap" ref={ref}>
      <button className={`icon-btn attach-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title={reviewCount ? `${reviewCount} review comment${reviewCount > 1 ? 's' : ''} waiting` : 'Share: get comments from someone else, or hand a request to whoever will run it'}><Share2 size={15} />{reviewCount > 0 ? <b>{reviewCount}</b> : reviewing ? <i className="live-dot abs" /> : null}</button>
      {open && (
        <div className="git-pop handoff-pop">
          <button onClick={pick(onReview)}><MessageSquare size={13} /><span><b>Get comments on this site…</b><small>{reviewCount ? `${reviewCount} comment${reviewCount > 1 ? 's' : ''} waiting` : reviewing ? 'Sharing now. Open to see the link and comments' : 'A link for someone on your network: they click and comment, it lands here'}</small></span></button>
          <button disabled={!hasRequest} onClick={pick(onExport)}><Download size={13} /><span><b>Save hand-off file…</b><small>Your notes, picks and screenshots in one file</small></span></button>
          <button disabled={!hasRequest} onClick={pick(onCopy)}><Share2 size={13} /><span><b>Copy as Markdown</b><small>Paste into an issue, a ticket or chat</small></span></button>
          <button disabled={!hasRequest || !canIssue} onClick={pick(onIssue)}><Share2 size={13} /><span><b>Create GitHub issue</b><small>{canIssue ? 'Screenshots go in a secret gist linked from the issue' : 'Needs the GitHub CLI, signed in'}</small></span></button>
          <button onClick={pick(onImport)}><Upload size={13} /><span><b>Open hand-off file…</b><small>Load someone's request, then send it to the agent</small></span></button>
        </div>
      )}
    </div>
  );
}
