const fs = require('node:fs');
const path = require('node:path');
const { walkAsync } = require('./snapshot.cjs');

const SOURCE = /\.(m?[jt]sx?|py|rb|go|php)$/;
const SKIP = /(^|\/)(tests?|__tests__|e2e|cypress|playwright|stories|fixtures|migrations)\/|\.(test|spec|stories|d)\.[a-z]+$/;
const MAX_FILES = 4000;
const MAX_BYTES = 300 * 1024;
const VERBS = 'get|post|put|patch|delete|head|options|all|any|route|use|api_route|websocket';
const CALL = new RegExp(`(?:\\.|@[\\w.]*\\.|\\b)(${VERBS})\\s*\\(\\s*(?:[rf])?(['"\`])(/[^'"\`\\n]*)\\2`, 'gi');
const DJANGO = /\b(?:path|re_path|url)\s*\(\s*r?(['"])([^'"\n]*)\1/g;
const RAILS = /^\s*(get|post|put|patch|delete|match)\s+(['"])(\/?[^'"\n]+)\2/gim;
const GO = /\b(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\s*\(\s*"(?:(GET|POST|PUT|PATCH|DELETE)\s+)?(\/[^"\n]*)"/g;

const cache = new Map();
const TTL = 10000;

function toRegex(pattern) {
  const body = pattern.split('/').map((seg) => {
    if (!seg) return '';
    if (/^(\[\[?\.\.\.|\*\*?$|\{.*\*\}$|\{\.\.\.)/.test(seg) || /^<path:/.test(seg) || seg === '*') return '.*';
    if (/^\[.+\]$/.test(seg) || /^[:$]/.test(seg) || /^\{.+\}$/.test(seg) || /^<.+>$/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return body;
}

function fileRoute(rel) {
  const noExt = rel.replace(/\.[a-z]+$/, '');
  let m;
  if ((m = /(?:^|\/)(?:src\/)?app\/(.*?)\/?route$/.exec(noExt))) return '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@')).join('/');
  if ((m = /(?:^|\/)(?:src\/)?pages\/(api(?:\/.*)?)$/.exec(noExt))) return '/' + m[1].replace(/\/index$/, '');
  if ((m = /(?:^|\/)src\/routes\/(.*?)\/?\+server$/.exec(noExt))) return '/' + m[1].split('/').filter((s) => !/^\(.*\)$/.test(s)).join('/');
  if ((m = /(?:^|\/)server\/(api|routes)\/(.*)$/.exec(noExt))) return (m[1] === 'api' ? '/api/' : '/') + m[2].replace(/\.(get|post|put|patch|delete)$/, '').replace(/\/index$/, '');
  if ((m = /(?:^|\/)(?:app\/)?routes\/(api[._].*)$/.exec(noExt))) return '/' + m[1].replace(/\./g, '/').replace(/\/_index$/, '');
  if ((m = /(?:^|\/)(?:netlify\/)?functions\/([^/]+)$/.exec(noExt))) return '/.netlify/functions/' + m[1];
  if ((m = /^api\/(.*)$/.exec(noExt)) && !rel.endsWith('.py')) return '/api/' + m[1].replace(/\/index$/, '');
  return null;
}

async function index(root) {
  const hit = cache.get(root);
  if (hit && Date.now() - hit.at < TTL) return hit.routes;
  const files = (await walkAsync(root)).filter((f) => SOURCE.test(f) && !SKIP.test(f)).slice(0, MAX_FILES);
  const routes = [];
  for (let i = 0; i < files.length; i += 64) {
    const batch = files.slice(i, i + 64);
    const texts = await Promise.all(batch.map(async (rel) => {
      try { const abs = path.join(root, rel); return (await fs.promises.stat(abs)).size <= MAX_BYTES ? await fs.promises.readFile(abs, 'utf8') : null; } catch { return null; }
    }));
    batch.forEach((rel, j) => {
      const text = texts[j];
      const byFile = fileRoute(rel);
      if (byFile != null) {
        const methods = text ? [...text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((m) => m[1]) : [];
        const fromName = /\.(get|post|put|patch|delete)\.[a-z]+$/.exec(rel);
        routes.push({ file: rel, line: 1, pattern: byFile || '/', methods: fromName ? [fromName[1].toUpperCase()] : methods, exact: true });
      }
      if (!text) return;
      const lineOf = (at) => text.slice(0, at).split('\n').length;
      for (const m of text.matchAll(CALL)) {
        const verb = m[1].toLowerCase();
        routes.push({ file: rel, line: lineOf(m.index), pattern: m[3], methods: /^(all|any|route|use|api_route|websocket)$/.test(verb) ? [] : [verb.toUpperCase()], mount: verb === 'use' });
      }
      if (rel.endsWith('.py')) for (const m of text.matchAll(DJANGO)) routes.push({ file: rel, line: lineOf(m.index), pattern: '/' + m[2].replace(/^\^|\$$/g, ''), methods: [] });
      if (rel.endsWith('.rb')) for (const m of text.matchAll(RAILS)) routes.push({ file: rel, line: lineOf(m.index), pattern: '/' + m[3].replace(/^\//, ''), methods: m[1] === 'match' ? [] : [m[1].toUpperCase()] });
      if (rel.endsWith('.go')) for (const m of text.matchAll(GO)) routes.push({ file: rel, line: lineOf(m.index), pattern: m[2], methods: m[1] ? [m[1]] : [] });
    });
  }
  cache.set(root, { at: Date.now(), routes });
  return routes;
}

async function find(root, url, method = 'GET') {
  if (!root) return null;
  let pathname;
  try { pathname = new URL(url, 'http://x').pathname.replace(/\/+$/, '') || '/'; } catch { return null; }
  const verb = String(method).toUpperCase();
  let best = null;
  for (const r of await index(root)) {
    if (r.mount) continue;
    const body = toRegex(r.pattern.replace(/\/+$/, '') || '/');
    if (!body || body === '/' && pathname !== '/') continue;
    let score = 0;
    if (new RegExp(`^${body}/?$`).test(pathname)) score = 100;
    else if (!r.exact && body.length > 1 && new RegExp(`${body}/?$`).test(pathname)) score = 60;
    else continue;
    score += r.pattern.split('/').filter((s) => s && !/[:[{<*]/.test(s)).length * 4;
    if (r.methods.length) score += r.methods.includes(verb) ? 20 : -30;
    if (r.exact) score += 5;
    if (!best || score > best.score) best = { ...r, score };
  }
  return best && best.score > 40 ? { file: best.file, line: best.line, pattern: best.pattern, methods: best.methods, sure: best.score >= 100 } : null;
}

module.exports = { find, fileRoute };
