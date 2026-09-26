// Maps a position in served (compiled) JS back to the original source file and
// line using the dev server's source maps. Used for React 19, whose elements only
// carry a stack trace into compiled code.
const path = require('node:path');
const { SourceMapConsumer } = require('source-map-js');

const cache = new Map(); // scriptUrl -> { at, consumer, mapUrl }
const TTL = 8000;        // dev servers rebuild often; keep maps briefly

async function fetchText(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function consumerFor(scriptUrl) {
  const hit = cache.get(scriptUrl);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const js = await fetchText(scriptUrl);
  const m = [...js.matchAll(/[#@]\s*sourceMappingURL=(\S+)\s*$/gm)].pop();
  let raw;
  let mapUrl = scriptUrl;
  if (m?.[1].startsWith('data:')) {
    const [meta, data] = m[1].split(',');
    raw = /;base64/.test(meta) ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  } else {
    mapUrl = new URL(m?.[1] || `${scriptUrl.split('?')[0]}.map`, scriptUrl).href;
    raw = await fetchText(mapUrl);
  }
  const entry = { at: Date.now(), consumer: new SourceMapConsumer(JSON.parse(raw)), mapUrl };
  cache.set(scriptUrl, entry);
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return entry;
}

// Turn whatever the map calls the source into a project-relative path.
function cleanSource(source, mapUrl, projectDir) {
  let s = source;
  s = s.replace(/^webpack:\/\/[^/]*\//, '').replace(/^webpack:\/\//, '').replace(/^turbopack:\/\/\/?(\[project\]\/)?/, '');
  if (/^https?:/.test(s)) s = decodeURIComponent(new URL(s).pathname);
  // Relative sources ("Hero.tsx", "../lib/x.ts") are relative to the map's URL.
  else if (!path.isAbsolute(s) && !/^[a-zA-Z]:/.test(s) && /^https?:/.test(mapUrl)) {
    s = decodeURIComponent(new URL(s, mapUrl).pathname);
  }
  s = s.replace(/^\/@fs\//, '').replace(/^\/?\.\//, '').replace(/[?#].*$/, '');
  const norm = (p) => p.replace(/\\/g, '/').replace(/^\/([a-zA-Z]:)/, '$1');
  const abs = norm(s);
  const root = norm(projectDir || '').replace(/\/$/, '');
  if (root && abs.toLowerCase().startsWith(root.toLowerCase() + '/')) return abs.slice(root.length + 1);
  return abs.replace(/^\//, '');
}

async function resolve({ url, line, column }, projectDir) {
  if (!/^https?:/.test(url)) return null;
  try {
    const { consumer, mapUrl } = await consumerFor(url);
    // Stack columns are 1-based; source-map columns are 0-based.
    const pos = consumer.originalPositionFor({ line, column: Math.max(0, column - 1) });
    if (!pos?.source) return null;
    return { file: cleanSource(pos.source, mapUrl, projectDir), line: pos.line || undefined, column: pos.column != null ? pos.column + 1 : undefined };
  } catch {
    return null;
  }
}

module.exports = { resolve };
