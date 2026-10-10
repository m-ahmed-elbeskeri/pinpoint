import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FileCode2, Link2, Route as RouteIcon } from './icons';
import type { RouteInfo } from '../lib/types';

interface Props {
  routes: RouteInfo[];
  current: RouteInfo | null;
  baseUrl: string;
  getLinks(): Promise<{ href: string; text: string }[]>;
  onGo(url: string): void;
  onEdit(url: string): void;
}

export function RoutePicker({ routes, current, baseUrl, getLinks, onGo, onEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [links, setLinks] = useState<{ href: string; text: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ('');
    getLinks().then(setLinks).catch(() => setLinks([]));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  const shownRoutes = useMemo(() => routes.filter((r) => match(r.route) || match(r.file)), [routes, q]);
  const shownLinks = useMemo(() => links.filter((l) => match(l.href) || match(l.text)).slice(0, 40), [links, q]);

  const toUrl = (route: string) => baseUrl.replace(/\/$/, '') + (route.startsWith('/') ? route : '/' + route);
  const pick = (r: RouteInfo) => {
    setOpen(false);
    if (r.dynamic) onEdit(toUrl(r.route));
    else onGo(toUrl(r.route));
  };

  return (
    <div className="route-picker" ref={ref}>
      <button type="button" className={`route-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title={current ? `${current.route} → ${current.file}` : 'Pages in this project'}>
        <RouteIcon size={14} />
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="route-menu">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pages…" onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
          <div className="route-scroll">
            <div className="dd-title">Pages in project {routes.length ? `· ${routes.length}` : ''}</div>
            {shownRoutes.length === 0 && <div className="route-empty">{routes.length ? 'No match' : 'No routes found in the project folder'}</div>}
            {shownRoutes.map((r) => (
              <button key={r.route} className={`route-item ${current?.route === r.route ? 'sel' : ''}`} onClick={() => pick(r)} title={r.dynamic ? 'Dynamic route: opens in the URL bar so you can fill in the parameters' : r.file}>
                <span className="route-path">{r.route.split(/(\[[^\]]+\]|:[\w]+|\*)/).map((part, i) => (/^(\[|:|\*)/.test(part) ? <em key={i}>{part}</em> : part))}</span>
                <span className="route-file"><FileCode2 size={11} /> {r.file}</span>
              </button>
            ))}
            {shownLinks.length > 0 && (
              <>
                <div className="dd-title">Links on this page</div>
                {shownLinks.map((l) => (
                  <button key={l.href} className="route-item" onClick={() => { setOpen(false); onGo(l.href); }} title={l.href}>
                    <span className="route-path">{l.text || l.href}</span>
                    <span className="route-file"><Link2 size={11} /> {l.href.replace(/^https?:\/\/[^/]+/, '') || '/'}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
