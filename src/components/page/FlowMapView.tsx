import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FlowMap, Loader2, Plus, Wrench, X } from '../ui/icons';
import type { FlowMapEvent, FlowMapPage, RouteInfo } from '../../types';
import { useEscape } from '../../lib/hooks';

interface Props {
  start: string;
  origin: string;
  partition?: string;
  routes: RouteInfo[];
  onOpen(url: string): void;
  onAsk(text: string, replace?: boolean): void;
  onClose(): void;
}

interface State { status: 'idle' | 'running' | 'done' | 'stopped'; pages: FlowMapPage[]; capped?: boolean; error?: string }

const CARD_W = 180, CARD_H = 150, GAP_X = 90, GAP_Y = 26, PAD = 24;
const IDLE: State = { status: 'idle', pages: [] };
let kept: { start: string; state: State } | null = null;

const broken = (p: FlowMapPage) => !!p.error || p.status >= 400;

export function flowFindings(pages: FlowMapPage[], routes: RouteInfo[]) {
  const by = new Map(pages.map((p) => [p.path, p]));
  const from = (path: string) => pages.flatMap((p) => p.links.filter((l) => l.to === path).map((l) => ({ page: p.path, text: l.text })));
  const brokenLinks = pages.filter(broken).map((p) => ({ path: p.path, why: p.error || `answers ${p.status}`, from: from(p.path) }));
  const deadEnds = pages.filter((p) => !broken(p) && !p.links.length).map((p) => p.path);
  const visited = new Set(pages.flatMap((p) => [p.path.split('?')[0], p.redirected?.split('?')[0]].filter(Boolean) as string[]));
  const unlinked = routes.filter((r) => !r.dynamic && !visited.has(r.route) && !by.has(r.route)).map((r) => r.route);
  const redirects = pages.filter((p) => p.redirected).map((p) => ({ path: p.path, to: p.redirected! }));
  return { brokenLinks, deadEnds, unlinked, redirects };
}

/** Every page reachable by the site's own links, laid out by how many clicks they are from the start. */
export function FlowMapView({ start, origin, partition, routes, onOpen, onAsk, onClose }: Props) {
  const [state, setState] = useState<State>(kept?.start === start ? kept.state : IDLE);
  const [chosen, setChosen] = useState<string[]>([]);
  const [hover, setHover] = useState<string | null>(null);
  const [chrome, setChrome] = useState(false);
  useEffect(() => window.pinpoint.onFlowMapEvent((e: FlowMapEvent) => setState((s) => {
    if (e.type === 'start') return { status: 'running', pages: [] };
    if (e.type === 'page') return { ...s, pages: [...s.pages.filter((p) => p.path !== e.page.path), e.page] };
    return { ...s, status: e.stopped ? 'stopped' : 'done', capped: e.capped, error: e.error };
  })), []);
  useEffect(() => { kept = state.status === 'running' ? null : { start, state }; }, [state, start]);
  useEffect(() => () => { window.pinpoint.flowMapStop().catch(() => {}); }, []);
  useEffect(() => { if (state.status === 'idle') begin(); }, []);
  useEscape(onClose);

  function begin() {
    setChosen([]);
    setState({ status: 'running', pages: [] });
    window.pinpoint.flowMapStart({ start: origin + start, partition }).catch((e) => setState({ ...IDLE, status: 'stopped', error: String((e as Error).message || e) }));
  }

  const { pos, width, height, edges } = useMemo(() => {
    const cols = new Map<number, FlowMapPage[]>();
    for (const p of state.pages) cols.set(p.depth, [...(cols.get(p.depth) || []), p]);
    const pos = new Map<string, { x: number; y: number }>();
    let rows = 0;
    for (const [depth, list] of cols) {
      list.forEach((p, i) => pos.set(p.path, { x: PAD + depth * (CARD_W + GAP_X), y: PAD + i * (CARD_H + GAP_Y) }));
      rows = Math.max(rows, list.length);
    }
    // Header and footer links repeat on every page; by default only the start page's are drawn.
    const edges = state.pages.flatMap((p) => p.links
      .filter((l) => pos.has(l.to) && (chrome || l.where === 'content' || p.path === start))
      .map((l) => ({ from: p.path, to: l.to, text: l.text })));
    return { pos, edges, width: PAD * 2 + Math.max(1, cols.size) * (CARD_W + GAP_X) - GAP_X, height: PAD * 2 + Math.max(1, rows) * (CARD_H + GAP_Y) - GAP_Y };
  }, [state.pages, chrome, start]);

  const found = flowFindings(state.pages, routes);
  const focus = hover || chosen[chosen.length - 1] || null;
  const running = state.status === 'running';
  const fileFor = (path: string) => routes.find((r) => r.route === path.split('?')[0])?.file;
  const pick = (path: string, add: boolean) => setChosen((c) => (add ? (c.includes(path) ? c.filter((x) => x !== path) : [...c, path]) : c.length === 1 && c[0] === path ? [] : [path]));

  const askChosen = () => {
    const pages = chosen.map((p) => state.pages.find((x) => x.path === p)).filter(Boolean) as FlowMapPage[];
    const lines = pages.map((p, i) => `${i + 1}. ${p.path}${p.title ? ` ("${p.title}")` : ''}${fileFor(p.path) ? `, rendered by ${fileFor(p.path)}` : ''}`);
    const links = pages.flatMap((p) => p.links.filter((l) => chosen.includes(l.to)).map((l) => `- ${p.path} → ${l.to} by the link "${l.text || '(no text)'}"${l.where !== 'content' ? ` in the ${l.where}` : ''}`));
    onAsk(`This is about the flow through these pages, in this order:\n${lines.join('\n')}${links.length ? `\n\nHow they link to each other now:\n${links.join('\n')}` : '\n\nThey don\'t link to each other yet.'}`);
  };
  const askFix = () => {
    const out: string[] = [];
    for (const b of found.brokenLinks) out.push(`- ${b.path} ${b.why}${b.from.length ? `; linked from ${b.from.slice(0, 4).map((f) => `${f.page} ("${f.text || 'no text'}")`).join(', ')}` : ''}`);
    for (const d of found.deadEnds) out.push(`- ${d} has no links to anywhere else on the site: a dead end`);
    for (const u of found.unlinked) out.push(`- ${u} is a page in the project${fileFor(u) ? ` (${fileFor(u)})` : ''} that nothing links to`);
    onAsk(`Following every link from ${start}, Pinpoint found these problems with how the pages connect:\n${out.join('\n')}\n\nFix broken links (point them at the right page or create the missing one), give dead ends a way onward, and link the unreachable pages from where people would look for them, unless they are meant to be hidden.`, true);
  };
  const problems = found.brokenLinks.length + found.deadEnds.length + found.unlinked.length;
  const sel = chosen.length ? state.pages.find((p) => p.path === chosen[chosen.length - 1]) : null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal flowmap" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3><FlowMap size={15} /> User flows</h3>
          <span className="hint">
            {running ? `Following links… ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}`
              : `${state.pages.length} page${state.pages.length === 1 ? '' : 's'} reachable from ${start}${state.capped ? ' (stopped at 30)' : ''}`}
          </span>
          <div className="spacer" />
          <label className="flowmap-chrome" title="Header and footer links appear on every page; drawing them all hides the flow"><input type="checkbox" checked={chrome} onChange={(e) => setChrome(e.target.checked)} /> Header and footer links</label>
          {!running && problems > 0 && <button className="btn xs primary" onClick={askFix}><Wrench size={12} /> Fix {problems}</button>}
          {running
            ? <button className="btn xs" onClick={() => window.pinpoint.flowMapStop().then(() => setState((s) => ({ ...s, status: 'stopped' })))}>Stop</button>
            : <button className="btn xs" onClick={begin}>Map again</button>}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>

        <div className="flowmap-body">
          <div className="flowmap-canvas">
            {state.error && <div className="ws-error">{state.error}</div>}
            {!state.pages.length && running && <div className="flowmap-empty"><Loader2 size={16} className="spin" /> Loading {start}…</div>}
            <div className="flowmap-stage" style={{ width, height }}>
              <svg width={width} height={height} className="flowmap-edges">
                <defs><marker id="fm-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="context-stroke" /></marker></defs>
                {edges.map((e, i) => {
                  const a = pos.get(e.from)!, b = pos.get(e.to)!;
                  const back = b.x <= a.x;
                  const x1 = a.x + CARD_W, y1 = a.y + CARD_H / 2, x2 = b.x, y2 = b.y + CARD_H / 2;
                  const d = back
                    ? `M${a.x + CARD_W / 2},${a.y + CARD_H} C${a.x + CARD_W / 2},${a.y + CARD_H + 40} ${b.x + CARD_W / 2},${b.y + CARD_H + 40} ${b.x + CARD_W / 2},${b.y + CARD_H}`
                    : `M${x1},${y1} C${x1 + GAP_X / 2},${y1} ${x2 - GAP_X / 2},${y2} ${x2},${y2}`;
                  const state = !focus ? '' : e.from === focus ? 'out' : e.to === focus ? 'in' : 'faded';
                  return <path key={i} d={d} className={`${state} ${back ? 'back' : ''}`} markerEnd="url(#fm-arrow)"><title>{`${e.from} → ${e.to}${e.text ? ` ("${e.text}")` : ''}`}</title></path>;
                })}
              </svg>
              {state.pages.map((p) => {
                const at = pos.get(p.path)!;
                const bad = broken(p);
                return (
                  <button
                    key={p.path} type="button"
                    className={`flowmap-card ${chosen.includes(p.path) ? 'on' : ''} ${bad ? 'bad' : ''} ${focus && focus !== p.path && !edges.some((e) => (e.from === focus && e.to === p.path) || (e.to === focus && e.from === p.path)) ? 'faded' : ''}`}
                    style={{ left: at.x, top: at.y, width: CARD_W, height: CARD_H }}
                    onClick={(e) => pick(p.path, e.shiftKey || e.ctrlKey || e.metaKey)}
                    onDoubleClick={() => onOpen(origin + p.path)}
                    onMouseEnter={() => setHover(p.path)} onMouseLeave={() => setHover(null)}
                    title={`${p.path}${p.title ? `\n${p.title}` : ''}\nClick to select, Shift+click to add to a flow, double-click to open`}
                  >
                    {chosen.includes(p.path) && chosen.length > 1 && <i className="flowmap-n">{chosen.indexOf(p.path) + 1}</i>}
                    <span className="flowmap-thumb">{p.thumb ? <img src={p.thumb} alt="" /> : <em>{bad ? (p.error ? 'Didn’t load' : p.status) : 'No picture'}</em>}</span>
                    <b className="mono">{p.path}</b>
                    <small>{bad ? (p.error || `Answers ${p.status}`) : p.redirected ? `Goes to ${p.redirected}` : p.title || ' '}</small>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="flowmap-side">
            {sel ? (
              <>
                <b className="mono">{sel.path}</b>
                {sel.title && <small>{sel.title}</small>}
                {fileFor(sel.path) && <small className="mono">{fileFor(sel.path)}</small>}
                <h5>Links to</h5>
                {sel.links.length ? <ul>{sel.links.map((l) => <li key={l.to}><span className="mono">{l.to}</span> <small>{l.text || '(no text)'}{l.where !== 'content' ? ` · ${l.where}` : ''}</small></li>)}</ul> : <p className="hint">Nothing: a dead end.</p>}
                <h5>Linked from</h5>
                {(() => { const ins = state.pages.filter((p) => p.links.some((l) => l.to === sel.path)); return ins.length ? <ul>{ins.map((p) => <li key={p.path} className="mono">{p.path}</li>)}</ul> : <p className="hint">{sel.path === start ? 'Where the map starts.' : 'Nothing.'}</p>; })()}
                <div className="flowmap-actions">
                  <button className="btn xs" onClick={() => onOpen(origin + sel.path)}><ExternalLink size={12} /> Open</button>
                  <button className="btn xs primary" onClick={askChosen} title="Put these pages, in this order, and how they link, into your next message"><Plus size={12} /> {chosen.length > 1 ? `Add flow of ${chosen.length} pages` : 'Add to request'}</button>
                </div>
                {chosen.length < 2 && <p className="hint">Shift+click more pages, in order, to describe a whole flow: sign up, onboarding, checkout.</p>}
              </>
            ) : (
              <>
                <p className="hint">Each column is one more click away from {start}. Click a page to see its links; Shift+click several to describe a flow in your request.</p>
                {found.brokenLinks.length > 0 && <><h5>Broken</h5><ul>{found.brokenLinks.map((b) => <li key={b.path} className="bad"><span className="mono">{b.path}</span> <small>{b.why}</small></li>)}</ul></>}
                {found.deadEnds.length > 0 && <><h5>Dead ends</h5><ul>{found.deadEnds.map((d) => <li key={d} className="mono">{d}</li>)}</ul></>}
                {found.unlinked.length > 0 && <><h5>Nothing links here</h5><ul>{found.unlinked.map((u) => <li key={u} className="mono">{u}</li>)}</ul></>}
                {found.redirects.length > 0 && <><h5>Redirects</h5><ul>{found.redirects.map((r) => <li key={r.path}><span className="mono">{r.path}</span> <small>→ {r.to}</small></li>)}</ul></>}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
