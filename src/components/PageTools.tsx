import { useEffect, useRef, useState } from 'react';
import { Check, Download, FlaskConical, Layers, Loader2, Pause, Pin as PinIcon, Share2, StepForward, Trash2, Upload, X } from 'lucide-react';
import type { NetworkMode, PageEnv, Pin } from '../lib/types';

// Closes a popover when the user clicks anywhere outside it.
function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener('mousedown', fn);
    return () => window.removeEventListener('mousedown', fn);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

// ---------- page conditions: content stress, data states, animation speed ----------
export interface Conditions { stress: string[]; network: NetworkMode; anim: number }
export const NO_CONDITIONS: Conditions = { stress: [], network: 'normal', anim: 1 };

export const STRESS: { id: string; label: string; hint: string }[] = [
  { id: 'long', label: 'Long text', hint: 'Every piece of text three times as long' },
  { id: 'pseudo', label: 'Pseudo-localized', hint: 'Accented and longer, like a translation' },
  { id: 'rtl', label: 'Right-to-left', hint: 'dir="rtl" on the page' },
  { id: 'empty', label: 'Empty lists', hint: 'Lists, tables and repeated items emptied' },
];
export const NETWORK: { id: NetworkMode; label: string; hint: string }[] = [
  { id: 'normal', label: 'Normal', hint: 'No simulation' },
  { id: 'slow', label: 'Slow', hint: 'Slow 3G: 400 ms latency, 50 kB/s' },
  { id: 'hang', label: 'Loading', hint: 'API requests never answer: the page stays in its loading state' },
  { id: 'error', label: 'Errors', hint: 'API requests fail with 500: the page shows its error state' },
  { id: 'offline', label: 'Offline', hint: 'No network at all' },
];
const SPEEDS = [{ rate: 1, label: '100%' }, { rate: 0.25, label: '25%' }, { rate: 0.1, label: '10%' }];

// Human-readable list of what is switched on, for the agent and the tooltip.
export function describeConditions(c: Conditions) {
  return [
    ...c.stress.map((s) => STRESS.find((x) => x.id === s)?.label.toLowerCase() || s),
    c.network !== 'normal' ? `network: ${NETWORK.find((n) => n.id === c.network)?.hint}` : '',
    c.anim !== 1 ? (c.anim === 0 ? 'animations paused' : `animations at ${c.anim * 100}% speed`) : '',
  ].filter(Boolean) as string[];
}

interface ConditionsProps {
  value: Conditions; set(next: Conditions): void; onStep(): void;
  env: PageEnv; setEnv(next: PageEnv): void;
  layout: boolean; setLayout(on: boolean): void;
}

export function ConditionsMenu({ value, set, onStep, env, setEnv, layout, setLayout }: ConditionsProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const count = describeConditions(value).length + (env.colorScheme ? 1 : 0) + (env.reducedMotion ? 1 : 0);
  const toggle = (id: string) => set({ ...value, stress: value.stress.includes(id) ? value.stress.filter((s) => s !== id) : [...value.stress, id] });

  return (
    <div className="cond-wrap" ref={ref}>
      <button type="button" className={count ? 'on' : ''} onClick={() => setOpen(!open)} title="How the page is shown: color scheme, motion, content stress tests, data states, animation speed">
        <FlaskConical size={14} />{count > 0 && <i className="cond-count">{count}</i>}
      </button>
      {open && (
        <div className="cond-pop">
          <h5>Display</h5>
          <div className="cond-row">
            {([[null, 'System'], ['dark', 'Dark'], ['light', 'Light']] as const).map(([v, label]) => (
              <button key={label} type="button" className={`chip ${env.colorScheme === v ? 'on' : ''}`} onClick={() => setEnv({ ...env, colorScheme: v })} title="Emulates prefers-color-scheme">{label}</button>
            ))}
            <button type="button" className={`chip ${env.reducedMotion ? 'on' : ''}`} onClick={() => setEnv({ ...env, reducedMotion: !env.reducedMotion })} title="Emulates prefers-reduced-motion">Reduced motion</button>
            <button type="button" className={`chip ${layout ? 'on' : ''}`} onClick={() => setLayout(!layout)} title="While selecting: margin (orange), padding (green), flex and grid children. Hold Alt to measure from the selected element.">Layout overlay</button>
          </div>
          <h5>Content</h5>
          <div className="cond-row">
            {STRESS.map((s) => <button key={s.id} type="button" className={`chip ${value.stress.includes(s.id) ? 'on' : ''}`} onClick={() => toggle(s.id)} title={s.hint}>{s.label}</button>)}
          </div>
          <h5>Data <span className="hint">reloads the page</span></h5>
          <div className="cond-row">
            {NETWORK.map((n) => <button key={n.id} type="button" className={`chip ${value.network === n.id ? 'on' : ''}`} onClick={() => set({ ...value, network: n.id })} title={n.hint}>{n.label}</button>)}
          </div>
          <h5>Animations</h5>
          <div className="cond-row">
            {SPEEDS.map((s) => <button key={s.rate} type="button" className={`chip ${value.anim === s.rate ? 'on' : ''}`} onClick={() => set({ ...value, anim: s.rate })}>{s.label}</button>)}
            <button type="button" className={`chip ${value.anim === 0 ? 'on' : ''}`} onClick={() => set({ ...value, anim: 0 })} title="Pause every animation and transition"><Pause size={11} /> Pause</button>
            <button type="button" className="chip" disabled={value.anim !== 0} onClick={onStep} title="While paused: advance by about a tenth of a second"><StepForward size={11} /> Step</button>
          </div>
          {count > 0 && <button type="button" className="btn xs ghost cond-reset" onClick={() => { set(NO_CONDITIONS); setEnv({ colorScheme: null, reducedMotion: false }); }}>Back to normal</button>}
        </div>
      )}
    </div>
  );
}

// ---------- variants: how many ways to try each request ----------
export const MAX_VARIANTS = 8;
const QUICK_VARIANTS = [0, 2, 3, 4];

export function VariantsMenu({ value, set }: { value: number; set(n: number): void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const ref = useClickAway(open, () => setOpen(false));
  useEffect(() => { if (open) setText(value >= 2 ? String(value) : ''); }, [open, value]);
  // 0 and 1 both mean "off": one way is just a normal request.
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

// ---------- pinned baselines: pages that should not change ----------
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
  const ref = useClickAway(open, () => setOpen(false));
  useEffect(() => { window.pinpoint.listPins().then(setPins).catch(() => setPins([])); }, [projectDir]);

  const act = async (what: string, fn: () => Promise<Pin[]>) => {
    setWorking(what);
    try { setPins(await fn()); } catch (e) { flash(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); } finally { setWorking(null); }
  };
  const changed = pins.filter((p) => p.changed).length;
  const canPin = /^https?:/.test(url) && !pins.some((p) => p.url === url);
  const path = (u: string) => { try { const x = new URL(u); return x.pathname + x.search; } catch { return u; } };

  return (
    <div className="git-wrap" ref={ref}>
      <button className={`chip ${changed ? 'warn' : pins.length ? '' : 'muted'}`} onClick={() => setOpen(!open)} title="Pinned pages: baselines that should not change">
        <PinIcon size={12} /> {changed ? `${changed} pin${changed > 1 ? 's' : ''} changed` : pins.length ? `${pins.length} pinned` : 'Pin'}
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

// ---------- hand-off: save a request for someone else to run ----------
interface HandoffProps {
  hasRequest: boolean;
  canIssue: boolean;
  onExport(): void; onCopy(): void; onIssue(): void; onImport(): void;
}

export function HandoffMenu({ hasRequest, canIssue, onExport, onCopy, onIssue, onImport }: HandoffProps) {
  const [open, setOpen] = useState(false);
  const ref = useClickAway(open, () => setOpen(false));
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="git-wrap" ref={ref}>
      <button className={`icon-btn attach-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Hand off: save this request for someone else to run, or open one"><Share2 size={15} /></button>
      {open && (
        <div className="git-pop handoff-pop">
          <button disabled={!hasRequest} onClick={pick(onExport)}><Download size={13} /><span><b>Save hand-off file…</b><small>Your notes, picks and screenshots in one file</small></span></button>
          <button disabled={!hasRequest} onClick={pick(onCopy)}><Share2 size={13} /><span><b>Copy as Markdown</b><small>Paste into an issue, a ticket or chat</small></span></button>
          <button disabled={!hasRequest || !canIssue} onClick={pick(onIssue)}><Share2 size={13} /><span><b>Create GitHub issue</b><small>{canIssue ? 'Screenshots go in a secret gist linked from the issue' : 'Needs the GitHub CLI, signed in'}</small></span></button>
          <button onClick={pick(onImport)}><Upload size={13} /><span><b>Open hand-off file…</b><small>Load someone's request, then send it to the agent</small></span></button>
        </div>
      )}
    </div>
  );
}
