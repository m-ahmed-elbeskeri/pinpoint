import { AlertTriangle, Gauge, SealCheck, Timer } from '../ui/icons';
import { flowVerdict } from '../../lib/flow';
import type { BuildSize, FlowResult, PerfMetrics } from '../../types';

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;

export function PerfLine({ perf }: { perf: { before: PerfMetrics; after: PerfMetrics } }) {
  const { before: b, after: a } = perf;
  const items: { text: string; worse: boolean }[] = [];
  const bytes = (label: string, x: number, y: number) => {
    const d = y - x;
    if (Math.abs(d) >= 1024 && Math.abs(d) >= x * 0.01) items.push({ text: `${kb(Math.abs(d))} ${d > 0 ? 'more' : 'less'} ${label}`, worse: d > 0 });
  };
  bytes('JavaScript', b.js, a.js);
  bytes('CSS', b.css, a.css);
  const req = a.requests - b.requests;
  if (req) items.push({ text: `${Math.abs(req)} ${req > 0 ? 'more' : 'fewer'} file${Math.abs(req) > 1 ? 's' : ''} to download`, worse: req > 0 });
  const nodes = a.nodes - b.nodes;
  if (Math.abs(nodes) >= 5) items.push({ text: `${Math.abs(nodes)} ${nodes > 0 ? 'more' : 'fewer'} elements on the page`, worse: nodes > 50 });
  if (Math.abs(a.cls - b.cls) >= 0.01) items.push({ text: a.cls > b.cls ? 'content jumps around more while loading' : 'content jumps around less while loading', worse: a.cls > b.cls });
  if (b.lcp && a.lcp && Math.abs(a.lcp - b.lcp) >= 150) items.push({ text: `main content appears ${Math.abs(a.lcp - b.lcp)} ms ${a.lcp > b.lcp ? 'later' : 'sooner'}`, worse: a.lcp > b.lcp });
  const worse = items.some((i) => i.worse), better = items.some((i) => !i.worse);
  if (!items.length) return null;
  return (
    <div className={`route-check ${worse ? 'moved' : ''}`}>
      <Timer size={12} />
      <span>{worse && better ? 'Loading changed' : worse ? 'Loads a little heavier' : 'Loads a little lighter'}:</span>
      {items.map((i) => <span key={i.text} className={i.worse ? 'worse' : 'better'}>{i.text}</span>)}
    </div>
  );
}

export function FlowLine({ flow, onFix }: { flow: FlowResult; onFix(): void }) {
  const v = flowVerdict(flow);
  const detail = [...flow.errors, ...flow.failed];
  return (
    <div className={`flow-check ${v.ok ? 'ok' : 'bad'}`}>
      <div className="flow-head">
        {v.ok ? <SealCheck size={13} weight="fill" /> : <AlertTriangle size={13} />}
        <span>{v.text}</span>
        {!v.ok && <button className="link-btn" onClick={onFix}>Ask to fix</button>}
      </div>
      {detail.length > 0 && <ul>{detail.slice(0, 4).map((d) => <li key={d}>{d}</li>)}</ul>}
    </div>
  );
}

export function PerfStats({ perf }: { perf: { before: PerfMetrics; after: PerfMetrics } }) {
  const { before: b, after: a } = perf;
  const rows: [string, string, string, string?][] = [
    ['JavaScript downloaded', kb(b.js), kb(a.js)],
    ['CSS downloaded', kb(b.css), kb(a.css)],
    ['Files requested', String(b.requests), String(a.requests)],
    ['Elements on the page', String(b.nodes), String(a.nodes)],
    ['Content jumping while loading', String(b.cls), String(a.cls), '0 is none, under 0.1 is good'],
    ['Time until the main content shows', b.lcp ? `${b.lcp} ms` : '?', a.lcp ? `${a.lcp} ms` : '?'],
  ];
  return (
    <div className="load-stats">
      <div className="load-stats-head"><span>How this page loads</span><span>Before</span><span>After</span></div>
      {rows.map(([label, before, after, hint]) => (
        <div key={label} className={before === after ? '' : 'diff'} title={hint}>
          <span>{label}{hint && <small> ({hint})</small>}</span><span>{before}</span><span>{after}</span>
        </div>
      ))}
      <p>Measured on a fresh load of the dev build, so sizes are bigger than in production.</p>
    </div>
  );
}

export function BuildLine({ build }: { build: { now: BuildSize; previous: BuildSize | null } }) {
  const { now, previous } = build;
  const delta = (a: number, b: number) => { const d = a - b; return Math.abs(d) < 100 ? 'no change' : `${d > 0 ? '+' : '−'}${kb(Math.abs(d))}`; };
  const worse = !!previous && (now.jsGzip - previous.jsGzip > 100 || now.cssGzip - previous.cssGzip > 100);
  return (
    <div className={`route-check ${worse ? 'moved' : ''}`} title={`Production build, ${now.files} files\nJS ${kb(now.js)} (${kb(now.jsGzip)} gzipped)\nCSS ${kb(now.css)} (${kb(now.cssGzip)} gzipped)`}>
      <Gauge size={12} />
      <span>Production build: JS {kb(now.jsGzip)}, CSS {kb(now.cssGzip)} gzipped</span>
      {previous
        ? <span className={worse ? 'worse' : ''}>since last measured: JS {delta(now.jsGzip, previous.jsGzip)}, CSS {delta(now.cssGzip, previous.cssGzip)}</span>
        : <span>first measurement; the next one will show the difference</span>}
    </div>
  );
}
