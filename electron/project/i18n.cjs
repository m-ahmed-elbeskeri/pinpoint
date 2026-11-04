// Translation files: find the key a piece of on-screen text comes from, show it in every language,
// and write edits straight back into the JSON, keeping its indentation and key order.
const fs = require('node:fs');
const path = require('node:path');

const SKIP = new Set(['node_modules', '.git', '.pinpoint', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', 'coverage', '.cache', 'vendor', 'target']);
const I18N_DIR = /^(locales?|i18n|lang|langs|languages|messages|translations|intl|dictionaries)$/i;
const LOCALE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;
const MAX_FILES = 200;
const MAX_BYTES = 2 * 1024 * 1024;

// Every JSON file under a translations folder, with its locale and namespace:
// locales/en.json (en), locales/en/common.json (en, common), messages/fr-CA.json (fr-CA).
function scan(root) {
  const out = [];
  const walk = (dir, depth, inI18n) => {
    if (depth > 7 || out.length >= MAX_FILES) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) walk(abs, depth + 1, inI18n || I18N_DIR.test(e.name));
        continue;
      }
      if (!inI18n || !e.name.endsWith('.json')) continue;
      const base = e.name.slice(0, -5);
      const parent = path.basename(dir);
      let locale = null, ns = '';
      if (LOCALE.test(base)) locale = base;
      else if (LOCALE.test(parent)) { locale = parent; ns = base; }
      if (!locale) continue;
      out.push({ file: path.relative(root, abs).split(path.sep).join('/'), abs, locale, ns });
    }
  };
  walk(root, 0, false);
  return out;
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
  }
  return out;
}

function load(f) {
  try {
    if (fs.statSync(f.abs).size > MAX_BYTES) return null;
    const json = JSON.parse(fs.readFileSync(f.abs, 'utf8'));
    return { ...f, json, flat: flatten(json) };
  } catch { return null; }
}

const norm = (s) => String(s).replace(/<\/?[\w-]+[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "Hello, {{name}}" matches "Hello, Sam": placeholders in every common syntax match anything.
function matcher(value) {
  const v = norm(value);
  if (!/\{\{?\s*[\w.]+\s*\}?\}|%[sd]|\$\{[\w.]+\}/.test(v)) return (t) => t === v;
  const re = new RegExp(`^${v.split(/(\{\{?\s*[\w.]+\s*\}?\}|%[sd]|\$\{[\w.]+\})/).map((p, i) => (i % 2 ? '.+?' : escape(p))).join('')}$`);
  return (t) => re.test(t);
}

function find(root, text) {
  const want = norm(text);
  if (!want || want.length > 500) return { files: 0, matches: [] };
  const files = scan(root).map(load).filter(Boolean);
  const byNs = new Map();
  for (const f of files) byNs.set(f.ns, [...(byNs.get(f.ns) || []), f]);
  const matches = [];
  for (const [ns, group] of byNs) {
    const keys = new Set();
    for (const f of group) for (const [k, v] of f.flat) if (!keys.has(k) && matcher(v)(want)) keys.add(k);
    for (const key of [...keys].slice(0, 4)) {
      matches.push({
        key, ns,
        values: group.map((f) => ({ locale: f.locale, file: f.file, value: f.flat.get(key) ?? null })).sort((a, b) => a.locale.localeCompare(b.locale)),
      });
    }
    if (matches.length >= 6) break;
  }
  return { files: files.length, matches };
}

// Keys the main language has that the others don't, per namespace.
function missing(root) {
  const files = scan(root).map(load).filter(Boolean);
  const byNs = new Map();
  for (const f of files) byNs.set(f.ns, [...(byNs.get(f.ns) || []), f]);
  const out = [];
  for (const [ns, group] of byNs) {
    if (group.length < 2) continue;
    const main = group.find((f) => /^en\b/i.test(f.locale)) || [...group].sort((a, b) => b.flat.size - a.flat.size)[0];
    for (const f of group) {
      if (f === main) continue;
      const keys = [...main.flat.keys()].filter((k) => !f.flat.get(k)?.trim());
      if (keys.length) out.push({ ns, from: main.file, fromLocale: main.locale, file: f.file, locale: f.locale, keys: keys.slice(0, 80), count: keys.length });
    }
  }
  return out;
}

function setPath(obj, key, value) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) { obj[key] = value; return; }
  const parts = key.split('.');
  let at = obj;
  for (const p of parts.slice(0, -1)) {
    if (!at[p] || typeof at[p] !== 'object') at[p] = {};
    at = at[p];
  }
  at[parts[parts.length - 1]] = value;
}

// Returns [abs, content] pairs to write, and the files they touch.
function prepare(root, edits) {
  const known = new Map(scan(root).map((f) => [f.file, f]));
  const byFile = new Map();
  for (const e of edits) {
    const f = known.get(e.file);
    if (!f) throw new Error(`${e.file} isn't a translation file Pinpoint found`);
    if (typeof e.value !== 'string') throw new Error('A translation has to be text');
    byFile.set(f, [...(byFile.get(f) || []), e]);
  }
  const writes = [], summary = [];
  for (const [f, list] of byFile) {
    const text = fs.readFileSync(f.abs, 'utf8');
    const json = JSON.parse(text);
    for (const e of list) { setPath(json, e.key, e.value); summary.push(`${f.locale} ${e.key} → "${e.value.length > 40 ? e.value.slice(0, 40) + '…' : e.value}"`); }
    const indent = (/\n([ \t]+)"/.exec(text) || ['', '  '])[1];
    writes.push([f.abs, JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : '')]);
  }
  return { writes, summary, files: [...byFile.keys()].map((f) => f.file) };
}

module.exports = { scan, find, missing, prepare, matcher };
