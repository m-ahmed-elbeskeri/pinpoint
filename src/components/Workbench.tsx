import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Check, Globe, Loader2, Play, Trash2, UserRound, X } from 'lucide-react';
import type { BgRun, ComponentEntry, ComponentProp, Profile } from '../lib/types';
import type { WorkspaceSpec } from '../lib/workspace';

const errText = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

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

// ---------- component workspace ----------
// Any component in the project, rendered alone in the page with controls for
// its props and a grid of its variants.
interface ComponentsProps {
  render(spec: Omit<WorkspaceSpec, 'left'>): Promise<{ ok: boolean; error?: string } | null>;
  close(): void;
  onClose(): void;
}

const starting = (p: ComponentProp): unknown => {
  if (p.default !== undefined) return p.default;
  if (p.type === 'enum') return p.options?.[0];
  if (p.type === 'boolean') return false;
  if (p.type === 'number') return p.required ? 1 : undefined;
  if (p.type === 'string') return p.required ? p.name.replace(/^\w/, (c) => c.toUpperCase()) : undefined;
  if (p.type === 'node') return p.name === 'children' ? 'Content' : undefined;
  return undefined;
};

export function ComponentsPanel({ render, close, onClose }: ComponentsProps) {
  const [list, setList] = useState<ComponentEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ComponentEntry | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [grid, setGrid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { window.pinpoint.listComponents().then(setList).catch(() => setList([])); }, []);
  const shown = useMemo(() => (list || []).filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const variantProps = picked?.props.filter((p) => p.type === 'enum' || p.type === 'boolean') || [];

  // Every combination of the first two variant props, or the single current state.
  const cells = (c: ComponentEntry, v: Record<string, unknown>, all: boolean): WorkspaceSpec['cells'] => {
    const clean = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && x !== ''));
    const axes = all ? c.props.filter((p) => p.type === 'enum' || p.type === 'boolean').slice(0, 2) : [];
    if (!axes.length) return [{ label: c.name, props: clean }];
    const opts = (p: ComponentProp) => (p.type === 'boolean' ? [false, true] : p.options || []);
    const out: WorkspaceSpec['cells'] = [];
    for (const a of opts(axes[0])) {
      for (const b of axes[1] ? opts(axes[1]) : [undefined]) {
        out.push({
          label: `${axes[0].name}=${a}${axes[1] ? ` · ${axes[1].name}=${b}` : ''}`,
          props: { ...clean, [axes[0].name]: a, ...(axes[1] && { [axes[1].name]: b }) },
        });
      }
    }
    return out.slice(0, 24);
  };

  const show = async (c: ComponentEntry, v: Record<string, unknown>, all: boolean) => {
    setError(null);
    const r = await render({ file: c.file, name: c.name, isDefault: c.isDefault, cells: cells(c, v, all) });
    if (!r?.ok) setError(r?.error || "Couldn't render it. Is the page loaded?");
  };
  const pick = (c: ComponentEntry) => {
    const v = Object.fromEntries(c.props.map((p) => [p.name, starting(p)]));
    setPicked(c); setValues(v); setGrid(false);
    show(c, v, false);
  };
  const change = (name: string, value: unknown) => {
    const v = { ...values, [name]: value };
    setValues(v);
    if (picked) show(picked, v, grid);
  };

  return (
    <aside className="ws-panel">
      <div className="ws-head">
        <Boxes size={14} /><b>Components</b>
        <div className="spacer" />
        <button className="icon-btn xs" onClick={() => { close(); onClose(); }} title="Close the workspace"><X size={13} /></button>
      </div>
      {!picked ? (
        <>
          <input className="ws-search" placeholder={list ? `Search ${list.length} components…` : 'Reading the project…'} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <ul className="ws-list">
            {list === null && <li className="ws-note"><Loader2 size={13} className="spin" /> Looking for components…</li>}
            {list?.length === 0 && <li className="ws-note">No exported React components found (.tsx / .jsx files).</li>}
            {shown.map((c) => (
              <li key={`${c.file}#${c.name}`}>
                <button onClick={() => pick(c)} title={c.file}><b>{c.name}</b><small>{c.file}</small></button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="ws-detail">
          <button className="ws-back" onClick={() => { setPicked(null); setError(null); close(); }}>← All components</button>
          <div className="ws-title"><b>&lt;{picked.name}&gt;</b><small>{picked.file}</small></div>
          {error && <div className="ws-error">{error}</div>}
          {picked.props.length === 0 && <p className="hint">This component takes no props that can be set here.</p>}
          {picked.props.map((p) => (
            <label key={p.name} className="ws-prop">
              <span>{p.name}{p.required ? ' *' : ''}</span>
              {p.type === 'boolean' ? <input type="checkbox" checked={!!values[p.name]} onChange={(e) => change(p.name, e.target.checked)} />
                : p.type === 'enum' ? (
                  <select value={String(values[p.name] ?? '')} onChange={(e) => change(p.name, e.target.value || undefined)}>
                    {!p.required && <option value="">(not set)</option>}
                    {p.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : p.type === 'number' ? <input type="number" value={values[p.name] === undefined ? '' : String(values[p.name])} onChange={(e) => change(p.name, e.target.value === '' ? undefined : +e.target.value)} />
                  : p.type === 'string' || p.type === 'node' ? <input value={String(values[p.name] ?? '')} placeholder={p.type === 'node' ? 'text' : ''} onChange={(e) => change(p.name, e.target.value)} />
                    : <input disabled placeholder="set in code" />}
            </label>
          ))}
          {variantProps.length > 0 && (
            <label className="ws-grid-toggle">
              <input type="checkbox" checked={grid} onChange={(e) => { setGrid(e.target.checked); show(picked, values, e.target.checked); }} />
              Show every variant <span className="hint">({variantProps.slice(0, 2).map((p) => p.name).join(' × ')})</span>
            </label>
          )}
          <p className="hint">It is rendered in the page, so you can pick it, tweak it and send requests about it like anything else.</p>
        </div>
      )}
    </aside>
  );
}

// ---------- "view as" profiles ----------
// A profile is its own browser storage: log in once and that tab stays that
// user. It can also set the language, time zone, feature flags and headers.
interface ProfileMenuProps {
  profiles: Profile[];
  current: string; // '' = the default browser
  onPick(id: string): void;
  onSave(list: Profile[]): void;
}

export function ProfileMenu({ profiles, current, onPick, onSave }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Profile | null>(null);
  const ref = useClickAway(open, () => { setOpen(false); setEditing(null); });
  const active = profiles.find((p) => p.id === current);

  const save = (p: Profile) => {
    onSave(profiles.some((x) => x.id === p.id) ? profiles.map((x) => (x.id === p.id ? p : x)) : [...profiles, p]);
    setEditing(null);
  };
  const field = (key: keyof Profile, label: string, placeholder: string, area = false) => (
    <label className="git-field">{label}
      {area
        ? <textarea rows={2} value={(editing![key] as string) || ''} placeholder={placeholder} spellCheck={false} onChange={(e) => setEditing({ ...editing!, [key]: e.target.value })} />
        : <input value={(editing![key] as string) || ''} placeholder={placeholder} spellCheck={false} onChange={(e) => setEditing({ ...editing!, [key]: e.target.value })} />}
    </label>
  );

  return (
    <div className="cond-wrap" ref={ref}>
      <button type="button" className={`profile-btn ${active ? 'on' : ''}`} onClick={() => setOpen(!open)} title={active ? `Viewing as ${active.name}` : 'View as: a saved login, language, time zone or set of feature flags'}>
        <UserRound size={14} />{active && <span>{active.name}</span>}
      </button>
      {open && (
        <div className="cond-pop profile-pop">
          {editing ? (
            <>
              <h5>{profiles.some((p) => p.id === editing.id) ? 'Edit profile' : 'New profile'}</h5>
              {field('name', 'Name', 'Admin, Free user, German visitor…')}
              {field('locale', 'Language', 'de-DE (blank = yours)')}
              {field('timezone', 'Time zone', 'Europe/Berlin (blank = yours)')}
              {field('flags', 'Feature flags and other storage values, one key=value per line', 'newCheckout=true', true)}
              {field('headers', 'Extra request headers, one Name: value per line', 'X-Debug-User: admin', true)}
              <div className="git-actions">
                <button type="button" className="btn xs ghost" onClick={() => setEditing(null)}>Cancel</button>
                <div className="spacer" />
                <button type="button" className="btn xs primary" disabled={!editing.name.trim()} onClick={() => save({ ...editing, name: editing.name.trim() })}>Save</button>
              </div>
            </>
          ) : (
            <>
              <h5>View this tab as</h5>
              <button type="button" className={`profile-row ${current === '' ? 'on' : ''}`} onClick={() => { onPick(''); setOpen(false); }}>
                <span><b>Default</b><small>Your normal browser session</small></span>{current === '' && <Check size={13} />}
              </button>
              {profiles.map((p) => (
                <div key={p.id} className={`profile-row ${current === p.id ? 'on' : ''}`}>
                  <button type="button" onClick={() => { onPick(p.id); setOpen(false); }}>
                    <span><b>{p.name}</b><small>{[p.locale, p.timezone, p.flags?.trim() && 'flags', p.headers?.trim() && 'headers'].filter(Boolean).join(' · ') || 'Its own login'}</small></span>
                    {current === p.id && <Check size={13} />}
                  </button>
                  <button type="button" className="mini-btn" onClick={() => setEditing(p)} title="Edit">✎</button>
                  <button type="button" className="mini-btn" onClick={() => { if (current === p.id) onPick(''); onSave(profiles.filter((x) => x.id !== p.id)); }} title="Delete profile"><Trash2 size={11} /></button>
                </div>
              ))}
              <button type="button" className="btn xs" onClick={() => setEditing({ id: Math.random().toString(36).slice(2, 10), name: '' })}>New profile</button>
              <p className="hint">Each profile keeps its own cookies and storage: log in once and it stays logged in. Two tabs can show two users side by side.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- background runs ----------
interface BgProps {
  runs: BgRun[];
  onApply(run: BgRun): void;
  onDiscard(run: BgRun): void;
  onDiff(run: BgRun): void;
}

export function BackgroundRuns({ runs, onApply, onDiscard, onDiff }: BgProps) {
  const [shots, setShots] = useState<Record<string, string>>({});
  useEffect(() => {
    for (const r of runs) {
      if (r.shot && !shots[r.id]) window.pinpoint.bgShot(r.id).then((s) => { if (s) setShots((prev) => ({ ...prev, [r.id]: s })); }).catch(() => {});
    }
  }, [runs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!runs.length) return null;
  return (
    <div className="bg-runs">
      {runs.map((r) => (
        <div key={r.id} className={`bg-run ${r.status}`}>
          <div className="bg-head">
            {r.status === 'running' ? <Loader2 size={13} className="spin" /> : r.status === 'done' ? <Check size={13} /> : <X size={13} />}
            <b title={r.title}>{r.title}</b>
            <span className="hint">{r.status === 'running' ? r.step || 'working in a separate copy…' : r.status === 'done' ? `${r.files?.length || 0} file${r.files?.length === 1 ? '' : 's'}` : 'failed'}</span>
          </div>
          {r.status !== 'running' && r.summary && <p className="bg-summary">{r.summary.split('\n').filter(Boolean).slice(0, 3).join(' ')}</p>}
          {shots[r.id] && <img className="bg-shot" src={shots[r.id]} alt="Result" />}
          <div className="bg-actions">
            {r.status === 'done' && !!r.files?.length && <button className="btn xs primary" onClick={() => onApply(r)} title="Bring these changes into your project"><Play size={11} /> Apply</button>}
            {r.status === 'done' && !!r.files?.length && <button className="btn xs" onClick={() => onDiff(r)}>Diff</button>}
            <div className="spacer" />
            <button className="btn xs ghost" onClick={() => onDiscard(r)}>{r.status === 'running' ? 'Stop' : 'Discard'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- other browser engines ----------
interface EnginesProps {
  url: string;
  capture(): Promise<string | null>;                 // this page as Pinpoint's own browser (Chromium) shows it
  shoot(): Promise<Record<string, string | { error: string }>>;
  onCompare(images: { before: string; after: string }, labels: [string, string], title: string): void;
  onClose(): void;
}

const ENGINE_NAMES: Record<string, string> = { webkit: 'WebKit (Safari)', firefox: 'Firefox' };

export function EnginesView({ url, capture, shoot, onCompare, onClose }: EnginesProps) {
  const [ready, setReady] = useState<boolean | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shots, setShots] = useState<{ chromium: string | null; others: Record<string, string | { error: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const [chromium, others] = await Promise.all([capture(), shoot()]);
      setShots({ chromium, others });
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  useEffect(() => {
    window.pinpoint.enginesStatus().then((s) => { setReady(s.ready); if (s.ready) run(); }).catch(() => setReady(false));
    return window.pinpoint.onEnginesProgress(setProgress);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const install = async () => {
    setProgress('Starting…'); setError(null);
    try { const s = await window.pinpoint.enginesInstall(); setReady(s.ready); if (s.ready) run(); else setError('The download finished but the engines are not complete. Try again.'); }
    catch (e) { setError(errText(e)); } finally { setProgress(null); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3><Globe size={15} /> Other browsers</h3>
          <span className="hint">{url}</span>
          <div className="spacer" />
          {ready && <button className="btn xs" disabled={busy} onClick={run}>{busy ? <Loader2 size={12} className="spin" /> : null} Refresh</button>}
          <button className="icon-btn" onClick={onClose} title="Close"><X size={16} /></button>
        </div>
        <div className="compare-body">
          {error && <div className="ws-error">{error}</div>}
          {ready === null ? <div className="diff-empty"><Loader2 className="spin" size={18} /></div>
            : !ready ? (
              <div className="engines-setup">
                <p>Pinpoint's own browser is Chromium. To see this page as <b>Safari</b> (WebKit) and <b>Firefox</b> render it, Pinpoint downloads those two engines once, through Playwright. It is about 300 MB and goes into the app's data folder.</p>
                <button className="btn primary" disabled={!!progress} onClick={install}>{progress ? <Loader2 size={13} className="spin" /> : null} {progress ? 'Downloading…' : 'Download WebKit and Firefox'}</button>
                {progress && <p className="hint mono">{progress}</p>}
              </div>
            ) : !shots ? <div className="diff-empty"><Loader2 className="spin" size={18} /> Rendering in WebKit and Firefox…</div>
              : (
                <div className="engines-grid">
                  <figure><figcaption>Chromium (this app)</figcaption>{shots.chromium ? <img src={shots.chromium} alt="Chromium" /> : <div className="ws-error">No capture</div>}</figure>
                  {Object.entries(shots.others).map(([engine, shot]) => (
                    <figure key={engine}>
                      <figcaption>
                        {ENGINE_NAMES[engine] || engine}
                        {typeof shot === 'string' && shots.chromium && (
                          <button className="btn xs" onClick={() => onCompare({ before: shots.chromium!, after: shot }, ['Chromium', ENGINE_NAMES[engine] || engine], `Chromium vs ${ENGINE_NAMES[engine] || engine}`)}>Compare</button>
                        )}
                      </figcaption>
                      {typeof shot === 'string' ? <img src={shot} alt={engine} /> : <div className="ws-error">{shot.error}</div>}
                    </figure>
                  ))}
                </div>
              )}
        </div>
      </div>
    </div>
  );
}
