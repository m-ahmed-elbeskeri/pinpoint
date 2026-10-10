import { useEffect, useRef, useState } from 'react';
import { SITE_LABEL, type SiteKind } from '../lib/site';

interface Props {
  kind: SiteKind;
  host: string;
  localUrl: string;
  liveUrl: string;
  canStartDev: boolean;
  onGo(url: string): void;
  onStartDev(): void;
}

const ABOUT: Record<'dev' | 'built' | 'live', { title: string; body: string }> = {
  dev: {
    title: 'Running on your machine',
    body: 'Changes show here as soon as the agent saves them (after a reload, if the server has no hot reload). With a framework dev server, picked elements also know their source file and line.',
  },
  built: {
    title: 'A built copy, running locally',
    body: "This is the production build served from your machine, so there is no hot reload: edits won't show here until it is rebuilt, and elements don't know their source line. Use the dev server to see changes straight away.",
  },
  live: {
    title: 'The deployed site',
    body: "You can still point, draw and send requests, but edits go to your local files and won't show on this page until you deploy. A deployed build doesn't say which file an element came from, so the agent finds the code by searching.",
  },
};

export function SiteChip({ kind, host, localUrl, liveUrl, canStartDev, onGo, onStartDev }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', fn);
    return () => window.removeEventListener('mousedown', fn);
  }, [open]);
  if (kind !== 'dev' && kind !== 'built' && kind !== 'live') return null;
  const about = ABOUT[kind];
  const go = (url: string) => { setOpen(false); onGo(url); };

  return (
    <div className="site-wrap" ref={ref}>
      <button type="button" className={`site-chip ${kind}`} onClick={() => setOpen(!open)} title={`${about.title}. Click for what that means.`}>
        <i />{SITE_LABEL[kind]}
      </button>
      {open && (
        <div className="site-pop">
          <b>{about.title}</b>
          <small className="mono">{host}</small>
          <p>{about.body}</p>
          <div className="site-actions">
            {kind !== 'dev' && localUrl && <button type="button" className="btn xs primary" onClick={() => go(localUrl)} title={localUrl}>Open this page locally</button>}
            {kind !== 'dev' && !localUrl && canStartDev && <button type="button" className="btn xs primary" onClick={() => { setOpen(false); onStartDev(); }}>Start the dev server</button>}
            {kind !== 'live' && liveUrl && <button type="button" className="btn xs" onClick={() => go(liveUrl)} title={liveUrl}>Open on the live site</button>}
          </div>
        </div>
      )}
    </div>
  );
}
