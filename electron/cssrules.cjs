const fs = require('node:fs');
const path = require('node:path');
const { SourceMapConsumer } = require('source-map-js');
const { cleanSource } = require('./sourcemap.cjs');

const MAX_RULES = 10;
const MAX_DECLS = 14;
const TRACKED = ['padding', 'margin', 'gap', 'border-radius', 'font-size', 'font-weight', 'line-height', 'opacity', 'color', 'background-color'];

const maps = new Map();

function covers(name, prop) {
  if (name === prop || name.startsWith(prop + '-') || prop.startsWith(name + '-')) return true;
  if (prop === 'border-radius') return /^border-.*-radius$/.test(name);
  if (prop === 'gap') return /^(row|column)-gap$/.test(name);
  return false;
}

async function mapFor(header) {
  if (maps.has(header.styleSheetId)) return maps.get(header.styleSheetId);
  let consumer = null;
  try {
    const ref = header.sourceMapURL;
    let raw;
    if (ref.startsWith('data:')) {
      const [meta, data] = [ref.slice(0, ref.indexOf(',')), ref.slice(ref.indexOf(',') + 1)];
      raw = /;base64/.test(meta) ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
    } else {
      const res = await fetch(new URL(ref, header.sourceURL).href, { signal: AbortSignal.timeout(4000) });
      if (res.ok) raw = await res.text();
    }
    if (raw) consumer = new SourceMapConsumer(JSON.parse(raw));
  } catch {  }
  maps.set(header.styleSheetId, consumer);
  if (maps.size > 80) maps.delete(maps.keys().next().value);
  return consumer;
}

const rel = (abs, root) => {
  const a = abs.replace(/\\/g, '/').replace(/^\/([a-zA-Z]:)/, '$1'), r = (root || '').replace(/\\/g, '/').replace(/\/$/, '');
  return r && a.toLowerCase().startsWith(r.toLowerCase() + '/') ? a.slice(r.length + 1) : null;
};

async function locate(rule, header, { cdp, projectDir, ownerFiles }) {
  if (!header) return {};
  const range = rule.selectorList?.selectors?.[0]?.range || rule.style?.range;
  const line0 = range ? range.startLine : null;
  if (header.sourceMapURL && line0 != null) {
    const consumer = await mapFor(header);
    const pos = consumer?.originalPositionFor({ line: line0 + 1, column: range.startColumn || 0 });
    if (pos?.source) return { file: cleanSource(pos.source, header.sourceURL || 'http://localhost/', projectDir), line: pos.line || undefined };
  }
  if (header.ownerNode && !header.sourceURL) {
    if (!ownerFiles.has(header.styleSheetId)) {
      let file = null;
      try {
        const attrs = (await cdp('DOM.describeNode', { backendNodeId: header.ownerNode })).node.attributes || [];
        const i = attrs.indexOf('data-vite-dev-id');
        if (i >= 0) file = rel(attrs[i + 1].replace(/[?#].*$/, ''), projectDir) || attrs[i + 1];
      } catch {  }
      ownerFiles.set(header.styleSheetId, file);
    }
    const file = ownerFiles.get(header.styleSheetId);
    return file ? { file, line: line0 != null && /\.css$/.test(file) ? line0 + 1 : undefined } : { file: 'inline <style>' };
  }
  if (/^https?:/.test(header.sourceURL || '')) {
    const p = decodeURIComponent(new URL(header.sourceURL).pathname).replace(/^\/@fs\//, '');
    for (const candidate of [p.replace(/^\//, ''), `public${p}`, `src${p}`]) {
      if (projectDir && fs.existsSync(path.join(projectDir, candidate))) return { file: candidate, line: line0 != null ? line0 + 1 + (header.startLine || 0) : undefined };
    }
    return { file: rel(p, projectDir) || p };
  }
  return {};
}

function guessLine(abs, selector) {
  let text;
  try { if (fs.statSync(abs).size > 600 * 1024) return null; text = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const lines = text.split('\n');
  const first = selector.split(',')[0].trim();
  const exact = lines.findIndex((l) => l.includes(first));
  if (exact >= 0) return exact + 1;
  const last = [...first.matchAll(/[.#]([\w-]+)/g)].pop();
  if (!last) return null;
  const name = last[1].replace(/^_(.+?)_[a-z0-9]{4,}_\d+$/i, '$1').replace(/^[A-Za-z0-9]+_(.+?)__[\w-]{4,}$/, '$1');
  const re = new RegExp(`(^|[\\s,>+~&])[.#&]-?${name.replace(/[-]/g, '\\-')}(?![\\w-])`);
  const near = lines.findIndex((l) => re.test(l) && !/^\s*(\/\/|\*|@apply|@include)/.test(l));
  return near >= 0 ? near + 1 : null;
}

const authored = (style) => (style?.cssProperties || [])
  .filter((p) => p.range && !p.disabled && p.parsedOk !== false && p.value)
  .map((p) => ({ name: p.name, value: p.value.length > 80 ? p.value.slice(0, 80) + '…' : p.value, important: !!p.important }));

async function matched({ cdp, nodeId, sheets, projectDir }) {
  const res = await cdp('CSS.getMatchedStylesForNode', { nodeId });
  const ownerFiles = new Map();
  const cascade = [];
  for (const m of res.matchedCSSRules || []) {
    const r = m.rule;
    if (r.origin !== 'regular') continue;
    const declarations = authored(r.style);
    if (!declarations.length) continue;
    cascade.push({ rule: r, selector: r.selectorList?.text || '', media: (r.media || []).map((x) => x.text).filter(Boolean).join(' and ') || undefined, declarations });
  }
  const inline = authored(res.inlineStyle);
  if (inline.length) cascade.push({ rule: null, selector: 'style attribute', declarations: inline });

  const winner = {};
  cascade.forEach((c, i) => {
    for (const d of c.declarations) {
      for (const prop of TRACKED) {
        if (!covers(d.name, prop)) continue;
        if (winner[prop] && winner[prop].important && !d.important) continue;
        winner[prop] = { i, important: d.important };
      }
    }
  });

  const out = [];
  for (let i = cascade.length - 1; i >= 0 && out.length < MAX_RULES; i--) {
    const c = cascade[i];
    const where = c.rule ? await locate(c.rule, sheets.get(c.rule.styleSheetId), { cdp, projectDir, ownerFiles }) : {};
    if (where.file && !where.line && projectDir && !/^(inline|https?:)/.test(where.file)) {
      const line = guessLine(path.resolve(projectDir, where.file), c.selector);
      if (line) { where.line = line; where.approx = true; }
      else if (/^\.[^\s.#:>+~,[]+$/.test(c.selector.replace(/\\./g, 'x'))) where.utility = true;
    }
    out.push({
      selector: c.selector.length > 140 ? c.selector.slice(0, 140) + '…' : c.selector,
      media: c.media,
      ...where,
      declarations: c.declarations.slice(0, MAX_DECLS),
      wins: TRACKED.filter((p) => winner[p]?.i === i),
    });
  }
  return out;
}

module.exports = { matched, guessLine };
