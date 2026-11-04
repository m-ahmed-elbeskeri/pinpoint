import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, ClipboardCopy, ExternalLink, FileCode2, FileMinus2, Plus, RotateCw, Trash2, Wand2, X } from '../ui/icons';
import { uid } from '../../lib/draw';
import type { ApiHandler, Mock, NetRequest } from '../../types';

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
const mockMatches = (m: Mock, method: string, url: string) => {
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

const STATUS_TEXT: Record<number, string> = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large', 422: 'Unprocessable Content', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};
const SLOW_MS = 500;
const statusLabel = (r: NetRequest) => (r.error && !r.status ? 'ERR' : String(r.status ?? '…'));
const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };
// A shell-ready cURL line, so a request can be rerun or pasted into an issue.
const asCurl = (r: NetRequest) => {
  const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
  const parts = ['curl', r.method !== 'GET' ? `-X ${r.method}` : '', q(r.url)];
  const heads = r.reqHeaders || {};
  for (const [k, v] of Object.entries(heads)) parts.push(`-H ${q(`${k}: ${v}`)}`);
  if (r.reqBody) parts.push(...(heads['content-type'] ? [] : [`-H 'Content-Type: application/json'`]), `--data-raw ${q(r.reqBody)}`);
  return parts.filter(Boolean).join(' ');
};

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function HeaderList({ title, headers, note }: { title: string; headers?: Record<string, string>; note: string }) {
  const rows = Object.entries(headers || {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <div className="net-headers">
      <div className="net-headers-title">{title} <i>{rows.length}</i></div>
      {rows.length ? (
        <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      ) : <div className="net-headers-none">{note}</div>}
    </div>
  );
}

function statusClass(r: NetRequest) {
  if (failed(r)) return 'bad';
  if ((r.status ?? 0) >= 300) return 'redirect';
  return 'ok';
}

export function NetworkPanel(p: Props) {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [show, setShow] = useState<'all' | 'failed' | 'slow'>('all');
  const [copied, setCopied] = useState('');
  // The selection ring is for keyboard users; a mouse click already shows where you are.
  const [kbd, setKbd] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [handlers, setHandlers] = useState<Record<string, ApiHandler | null>>({});
  const [draft, setDraft] = useState<Mock | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  const shown = useMemo(() => p.requests.filter((r) => (show === 'all' || (show === 'failed' ? failed(r) : (r.ms ?? 0) >= SLOW_MS)) && (!query || r.url.toLowerCase().includes(query.toLowerCase()))), [p.requests, show, query]);
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
  const slowCount = p.requests.filter((r) => (r.ms ?? 0) >= SLOW_MS).length;
  // Each row's timing bar is scaled to the slowest request in view.
  const maxMs = Math.max(1, ...shown.map((r) => r.ms ?? 0));
  const home = hostOf(p.requests[0]?.url || '');
  const copy = (what: string, text: string) => { navigator.clipboard.writeText(text).then(() => { setCopied(what); setTimeout(() => setCopied(''), 1400); }).catch(() => {}); };

  return (
    <div className="net">
      <div className="net-bar">
        <div className="seg net-seg">
          <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>All <i>{p.requests.length}</i></button>
          <button className={`${show === 'failed' ? 'on' : ''} ${failedCount ? 'has-bad' : ''}`} onClick={() => setShow('failed')}>Failed <i>{failedCount}</i></button>
          <button className={show === 'slow' ? 'on' : ''} onClick={() => setShow('slow')} title={`Took ${SLOW_MS} ms or longer`}>Slow <i>{slowCount}</i></button>
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
        <button className="btn ghost xs" onClick={() => { setPickedId(null); p.onClear(); }} title="Clear the list"><Trash2 size={12} /> Clear</button>
      </div>
      <div className="net-body">
        <div className={`net-list ${kbd ? 'kbd' : ''}`} ref={list} role="listbox" aria-label="Requests" tabIndex={0} onPointerDown={() => setKbd(false)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            setKbd(true);
            const at = shown.findIndex((r) => r.id + r.at === pickedId);
            const next = shown[Math.max(0, Math.min(shown.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
            if (next) { setPickedId(next.id + next.at); setDraft(null); list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.id + next.at)}"]`)?.scrollIntoView({ block: 'nearest' }); }
          }} onScroll={(e) => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 20; }}>
          {shown.length > 0 && <div className="net-cols" aria-hidden><span>Status</span><span>Method</span><span>Path</span><span /><span>Timing</span><span>Time</span></div>}
          {shown.length === 0 && (
            <div className="net-empty">
              {p.requests.length ? <><b>Nothing matches</b><span>Try another filter{query ? ' or clear the search' : ''}.</span></>
                : <><b>No requests yet</b><span>Fetch and XHR calls the page makes show up here. Reload the page to catch the ones it makes on load.</span></>}
            </div>
          )}
          {shown.map((r) => (
            <button key={r.id + r.at} data-key={r.id + r.at} role="option" aria-selected={pickedId === r.id + r.at} className={`net-row ${statusClass(r)} ${pickedId === r.id + r.at ? 'on' : ''}`} onClick={() => { setPickedId(r.id + r.at); setDraft(null); list.current?.focus({ preventScroll: true }); }} tabIndex={-1} title={`${r.method} ${r.url}${r.ms ? ` · ${r.ms.toLocaleString()} ms${r.ms >= SLOW_MS ? ' (slow)' : ''}` : ''}${r.error ? ` · failed: ${r.error}` : ''}`}>
              <span className="net-status">{statusLabel(r)}</span>
              <span className="net-method">{r.method}</span>
              <span className="net-path mono">{hostOf(r.url) !== home && <small>{hostOf(r.url)}</small>}{pathOf(r.url)}</span>
              <span className="net-tagcol">{p.mocks.some((m) => mockMatches(m, r.method, r.url)) && <span className="net-tag">mock</span>}</span>
              {/* Square-root scale so a fast request still shows a bar next to one slow one. */}
              <span className={`net-track ${(r.ms ?? 0) >= SLOW_MS ? 'slow' : ''}`}>{!!r.ms && <i style={{ width: `max(6px, ${Math.sqrt(r.ms / maxMs) * 100}%)` }} />}</span>
              <span className={`net-ms ${(r.ms ?? 0) >= SLOW_MS ? 'slow' : ''}`}>{r.ms ? `${r.ms.toLocaleString()} ms` : '–'}</span>
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
                <span className={`net-pill ${statusClass(picked)}`}>{statusLabel(picked)}{picked.status && (picked.statusText || STATUS_TEXT[picked.status]) ? ` ${picked.statusText || STATUS_TEXT[picked.status]}` : ''}</span>
                <b className="mono">{picked.method} {pathOf(picked.url)}</b>
                {!!picked.ms && <span className={`net-ms ${picked.ms >= SLOW_MS ? 'slow' : ''}`}>{picked.ms.toLocaleString()} ms</span>}
              </div>
              <div className="net-url mono" title={picked.url}>{picked.url}</div>
              <div className="net-meta">{[picked.kind === 'xhr' ? 'XHR' : 'fetch', picked.type?.split(';')[0], picked.size != null ? fmtSize(picked.size) : picked.resBody ? fmtSize(new Blob([picked.resBody]).size) : '', new Date(picked.at).toLocaleTimeString()].filter(Boolean).join(' · ')}</div>
              <div className="net-actions">
                <button className="btn xs primary" onClick={() => p.onAdd(picked, handler ?? null)} title="Attach this request, its response and its handler to your next message"><Plus size={12} /> {failed(picked) ? 'Attach to fix' : 'Attach to message'}</button>
                <button className="btn xs" disabled={busy} onClick={() => replay(picked)} title="Send the same request again from the page"><RotateCw size={12} className={busy ? 'spin' : ''} /> Send again</button>
                <button className="btn xs" onClick={() => startMock(picked)} title="Answer this endpoint with your own JSON">Mock response</button>
                <button className="btn xs ghost" onClick={() => copy('curl', asCurl(picked))} title="Copy this request as a cURL command">{copied === 'curl' ? <Check size={12} /> : <ClipboardCopy size={12} />} {copied === 'curl' ? 'Copied' : 'Copy as cURL'}</button>
              </div>
              {picked.error && <div className="net-error">{picked.error}</div>}
              <div className="net-handler">
                {handler === undefined ? <i>Looking for the handler…</i>
                  : handler ? <><FileCode2 size={12} /> Handled by <button className="mono" onClick={() => p.onOpenFile(handler.file, handler.line)} title="Open in your editor">{handler.file}:{handler.line} <ExternalLink size={10} /></button></>
                    : <><FileMinus2 size={12} /><i>No handler in this project (an external API, or a route this can't read)</i></>}
                {handler && !handler.sure && <i> (likely: matched on the end of the path)</i>}
              </div>
              <button className={`net-h4 net-fold ${headersOpen ? 'open' : ''}`} onClick={() => setHeadersOpen(!headersOpen)} aria-expanded={headersOpen}>
                <h4><ChevronRight size={11} /> Headers</h4>
                <span className="net-fold-sum">{Object.keys(picked.reqHeaders || {}).length} sent · {Object.keys(picked.resHeaders || {}).length} received</span>
              </button>
              {headersOpen && (picked.reqHeaders || picked.resHeaders ? (
                <div className="net-headers-wrap">
                  <HeaderList title="Request" headers={picked.reqHeaders} note="The page set no headers of its own." />
                  <HeaderList title="Response" headers={picked.resHeaders} note={picked.status ? 'None visible to the page. Cross-origin responses only expose CORS-safelisted headers.' : 'No response arrived.'} />
                  <div className="net-headers-foot">Browser-added headers like Cookie and User-Agent, and Set-Cookie on responses, aren't visible to page scripts.</div>
                </div>
              ) : <div className="net-headers-none">Headers weren't captured for this request. Reload the page to capture them.</div>)}
              {picked.reqBody && <><h4>Sent</h4><pre className="mono">{pretty(picked.reqBody)}</pre></>}
              <div className="net-h4"><h4>Response{picked.type ? ` · ${picked.type.split(';')[0]}` : ''}</h4>
                {picked.resBody && <button className="net-copy" onClick={() => copy('body', pretty(picked.resBody))} title="Copy the response body">{copied === 'body' ? <Check size={11} /> : <ClipboardCopy size={11} />}</button>}
              </div>
              <pre className="mono">{pretty(picked.resBody) || <span className="net-nobody">{picked.status === 204 || picked.status === 304 ? 'No body for this status' : 'Empty response'}</span>}</pre>
            </>
          ) : <div className="net-empty center"><b>Pick a request</b><span>See what was sent, what came back and which file in the project handles it. Use ↑ ↓ to move through the list.</span></div>}
        </div>
      </div>
    </div>
  );
}
