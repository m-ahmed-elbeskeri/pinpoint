import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Plus, RotateCw, Trash2, Wand2, X } from './icons';
import { uid } from '../lib/draw';
import type { ApiHandler, Mock, NetRequest } from '../lib/types';

interface Props {
  requests: NetRequest[];
  mocks: Mock[];
  setMocks(next: Mock[]): void;
  findHandler(url: string, method: string): Promise<ApiHandler | null>;
  onAdd(r: NetRequest, handler: ApiHandler | null): void;
  onReplay(r: NetRequest): Promise<void>;
  onOpenFile(file: string, line?: number): void;
  onBuild(m: Mock): void;
  onClear(): void;
}

export const pathOf = (url: string) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const barePath = (url: string) => pathOf(url).split('?')[0];
export const failed = (r: NetRequest) => !!r.error || (r.status ?? 0) >= 400 || r.status === 0;
export const pretty = (text: string | undefined) => {
  if (!text) return '';
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};
export const mockMatches = (m: Mock, method: string, url: string) => {
  if (!m.on || (m.method !== 'ANY' && m.method !== method)) return false;
  const bare = barePath(url);
  if (m.path === bare || m.path === pathOf(url)) return true;
  if (!m.path.includes('*')) return false;
  const parts = m.path.split('*');
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    const found = bare.indexOf(parts[i], at);
    if (found < 0 || (i === 0 && found !== 0)) return false;
    at = found + parts[i].length;
  }
  return parts[parts.length - 1] === '' || at === bare.length;
};

function statusClass(r: NetRequest) {
  if (failed(r)) return 'bad';
  if ((r.status ?? 0) >= 300) return 'warn';
  return 'ok';
}

export function NetworkPanel(p: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [handlers, setHandlers] = useState<Record<string, ApiHandler | null>>({});
  const [draft, setDraft] = useState<Mock | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  const shown = useMemo(() => p.requests.filter((r) => (!onlyFailed || failed(r)) && (!query || r.url.toLowerCase().includes(query.toLowerCase()))), [p.requests, onlyFailed, query]);
  const picked = p.requests.find((r) => r.id + r.at === pickedId) || null;
  const key = picked ? `${picked.method} ${barePath(picked.url)}` : '';
  const handler = key ? handlers[key] : undefined;

  useEffect(() => {
    if (!picked || key in handlers) return;
    let live = true;
    p.findHandler(picked.url, picked.method).then((h) => { if (live) setHandlers((m) => ({ ...m, [key]: h })); }, () => { if (live) setHandlers((m) => ({ ...m, [key]: null })); });
    return () => { live = false; };
  }, [key]);

  useEffect(() => { const el = list.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [shown.length]);

  const startMock = (r: NetRequest) => setDraft({ id: uid(), method: r.method, path: barePath(r.url), status: r.status && r.status < 400 ? r.status : 200, body: pretty(r.resBody && !failed(r) ? r.resBody : '') || '{\n  \n}', on: true });
  const saveMock = () => {
    if (!draft || !draft.path.trim()) return;
    p.setMocks([...p.mocks.filter((m) => m.id !== draft.id && !(m.method === draft.method && m.path === draft.path)), { ...draft, path: draft.path.trim() }]);
    setDraft(null);
  };
  const replay = async (r: NetRequest) => { setBusy(true); try { await p.onReplay(r); } finally { setBusy(false); } };
  const failedCount = p.requests.filter(failed).length;

  return (
    <div className="net">
      <div className="net-bar">
        <div className="seg net-seg">
          <button className={onlyFailed ? '' : 'on'} onClick={() => setOnlyFailed(false)}>All {p.requests.length}</button>
          <button className={onlyFailed ? 'on' : ''} onClick={() => setOnlyFailed(true)}>Failed {failedCount}</button>
        </div>
        <input className="net-filter" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by URL" spellCheck={false} />
        {p.mocks.map((m) => (
          <span key={m.id} className={`net-mock ${m.on ? 'on' : ''}`} title={`${m.method} ${m.path} answers ${m.status} with your JSON instead of the real server`}>
            <button onClick={() => p.setMocks(p.mocks.map((x) => (x.id === m.id ? { ...x, on: !x.on } : x)))}>{m.on ? 'Mock on' : 'Mock off'}</button>
            <button className="mono" onClick={() => setDraft(m)}>{m.method} {m.path}</button>
            <button onClick={() => p.onBuild(m)} title="Ask the agent to build this endpoint so it returns this"><Wand2 size={11} /></button>
            <button onClick={() => p.setMocks(p.mocks.filter((x) => x.id !== m.id))} title="Remove this mock"><X size={11} /></button>
          </span>
        ))}
        <div className="spacer" />
        <button className="btn ghost xs" onClick={() => setDraft({ id: uid(), method: 'GET', path: '/api/', status: 200, body: '{\n  \n}', on: true })} title="Answer an endpoint with your own JSON"><Plus size={12} /> Mock</button>
        <button className="btn ghost xs" onClick={() => { setPickedId(null); p.onClear(); }} title="Clear the list"><Trash2 size={12} /></button>
      </div>
      <div className="net-body">
        <div className="net-list" ref={list} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20; }}>
          {shown.length === 0 && <div className="net-empty">{p.requests.length ? 'Nothing matches.' : 'Requests the page makes to your API show up here. Pick one to point the agent at it.'}</div>}
          {shown.map((r) => (
            <button key={r.id + r.at} className={`net-row ${statusClass(r)} ${pickedId === r.id + r.at ? 'on' : ''}`} onClick={() => { setPickedId(r.id + r.at); setDraft(null); }}>
              <span className="net-status">{r.error && !r.status ? 'ERR' : r.status}</span>
              <span className="net-method">{r.method}</span>
              <span className="net-path mono">{pathOf(r.url)}</span>
              {p.mocks.some((m) => mockMatches(m, r.method, r.url)) && <span className="net-tag">mock</span>}
              <span className="net-ms">{r.ms != null ? `${r.ms} ms` : ''}</span>
            </button>
          ))}
        </div>
        <div className="net-detail">
          {draft ? (
            <div className="net-form">
              <b>Answer this endpoint yourself</b>
              <div className="net-form-row">
                <select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value })}>
                  {['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}
                </select>
                <input className="mono" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} placeholder="/api/orders or /api/orders/*" spellCheck={false} />
                <input className="net-code" type="number" min={100} max={599} value={draft.status} onChange={(e) => setDraft({ ...draft, status: Number(e.target.value) || 200 })} title="Status code" />
              </div>
              <textarea className="mono" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} spellCheck={false} placeholder="The response body" />
              <div className="net-actions">
                <button className="btn xs primary" onClick={saveMock}>Save mock</button>
                <button className="btn xs ghost" onClick={() => setDraft(null)}>Cancel</button>
                <span className="net-hint">Takes effect on the page's next request. Reload to see it.</span>
              </div>
            </div>
          ) : picked ? (
            <>
              <div className="net-head">
                <span className={`net-status ${statusClass(picked)}`}>{picked.error && !picked.status ? 'ERR' : picked.status}</span>
                <b className="mono">{picked.method} {pathOf(picked.url)}</b>
                {picked.ms != null && <span className="net-ms">{picked.ms} ms</span>}
              </div>
              <div className="net-actions">
                <button className="btn xs primary" onClick={() => p.onAdd(picked, handler ?? null)} title="Attach this request, its response and its handler to your next message"><Plus size={12} /> Add to request</button>
                <button className="btn xs" disabled={busy} onClick={() => replay(picked)} title="Send the same request again from the page"><RotateCw size={12} /> Send again</button>
                <button className="btn xs" onClick={() => startMock(picked)} title="Answer this endpoint with your own JSON">Mock response</button>
              </div>
              {picked.error && <div className="net-error">{picked.error}</div>}
              <div className="net-handler">
                Handled by{' '}
                {handler === undefined ? <i>looking…</i>
                  : handler ? <button className="mono" onClick={() => p.onOpenFile(handler.file, handler.line)} title="Open in your editor">{handler.file}:{handler.line} <ExternalLink size={10} /></button>
                    : <i>not found in the project (an external API, or a route this can't read)</i>}
                {handler && !handler.sure && <i> (likely: matched on the end of the path)</i>}
              </div>
              {picked.reqBody && <><h4>Sent</h4><pre className="mono">{pretty(picked.reqBody)}</pre></>}
              <h4>Response{picked.type ? ` · ${picked.type.split(';')[0]}` : ''}</h4>
              <pre className="mono">{pretty(picked.resBody) || '(empty)'}</pre>
            </>
          ) : <div className="net-empty">Pick a request to see what was sent, what came back and which file handles it.</div>}
        </div>
      </div>
    </div>
  );
}
