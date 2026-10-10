const { BrowserWindow, nativeImage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = require('./snapshot.cjs');
const { cellDiff, cellDiffAsync } = require('./celldiff.cjs');

const SIZE = { width: 1280, height: 1400 };
const LOAD_TIMEOUT_MS = 20000;
const SETTLE_MS = 800;
const NOISE_GAP_MS = 500;
const CHANGED_PCT = 0.5;
const MIN_CHANGED_PX = 30;
const MAX_ROUTES = 9;

const STILL_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

const captureIds = new Set();
let baseline = null;
let warming = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFor = (route) => route.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
const originOf = (url) => url.replace(/^(\w+:\/\/[^/]+).*/, '$1');

function fingerprint(root) {
  const h = crypto.createHash('sha1');
  for (const rel of snapshot.walk(root).sort()) {
    try { const st = fs.statSync(path.join(root, rel)); h.update(`${rel}:${st.mtimeMs}:${st.size}\n`); } catch {  }
  }
  return h.digest('hex');
}

async function fingerprintAsync(root) {
  const h = crypto.createHash('sha1');
  const files = (await snapshot.walkAsync(root)).sort();
  for (let i = 0; i < files.length; i += 64) {
    const stats = await Promise.all(files.slice(i, i + 64).map((rel) => fs.promises.stat(path.join(root, rel)).catch(() => null)));
    stats.forEach((st, j) => { if (st) h.update(`${files[i + j]}:${st.mtimeMs}:${st.size}\n`); });
  }
  return h.digest('hex');
}

const DEFAULT_PARTITION = 'persist:pinpoint';

async function visit(url, use, partition = DEFAULT_PARTITION) {
  const win = new BrowserWindow({
    show: false, frame: false, useContentSize: true, ...SIZE,
    webPreferences: { partition, offscreen: true, backgroundThrottling: false },
  });
  const id = win.webContents.id;
  captureIds.add(id);
  try {
    win.webContents.setAudioMuted(true);
    await Promise.race([win.loadURL(url), sleep(LOAD_TIMEOUT_MS).then(() => { throw new Error('timeout'); })]);
    await win.webContents.insertCSS(STILL_CSS).catch(() => {});
    await sleep(SETTLE_MS);
    return await use(win.webContents);
  } catch { return null; } finally {
    captureIds.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

const SIZE_DIFFERS = { pct: 100, changed: true, areas: { cells: [], whole: true } };

function bitmaps(a, b) {
  const ia = nativeImage.createFromBuffer(a.jpg), ib = nativeImage.createFromBuffer(b.jpg);
  const { width, height } = ia.getSize();
  const sb = ib.getSize();
  if (width !== sb.width || height !== sb.height) return null;
  return { pa: ia.toBitmap(), pb: ib.toBitmap(), width, height, ignore: new Set([...(a.noisy || []), ...(b.noisy || [])]) };
}

function verdict(d, width, height) {
  const pct = (d.px / (width * height)) * 100;
  const whole = d.cells.length > d.total * 0.6;
  return {
    pct: pct >= 1 ? Math.round(pct * 10) / 10 : Math.round(pct * 100) / 100,
    changed: pct >= CHANGED_PCT || whole || d.px >= MIN_CHANGED_PX,
    areas: { cells: d.cells.sort((p, q) => q.px - p.px).slice(0, 400), whole },
  };
}

function compare(a, b) {
  const m = bitmaps(a, b);
  return m ? verdict(cellDiff(m.pa, m.pb, m.width, m.height, m.ignore), m.width, m.height) : SIZE_DIFFERS;
}

async function compareAsync(a, b) {
  const m = bitmaps(a, b);
  return m ? verdict(await cellDiffAsync(m.pa, m.pb, m.width, m.height, m.ignore), m.width, m.height) : SIZE_DIFFERS;
}

const shoot = (url, partition) => visit(url, async (wc) => {
  const first = await wc.capturePage();
  if (first.isEmpty()) return null;
  await sleep(NOISE_GAP_MS);
  const second = await wc.capturePage();
  let noisy = [];
  const s1 = first.getSize(), s2 = second.getSize();
  if (!second.isEmpty() && s1.width === s2.width && s1.height === s2.height) {
    noisy = (await cellDiffAsync(first.toBitmap(), second.toBitmap(), s1.width, s1.height)).cells.map((c) => c.i);
  }
  return { jpg: first.toJPEG(82), noisy };
}, partition);

async function shootAll(routes, partition, workers = 3) {
  const shots = new Map();
  const queue = [...routes];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const shot = await shoot(r.url, partition);
      if (shot) shots.set(keyFor(r.route), shot);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
  return shots;
}

const NAME_AREAS = (cells, targets) => `(${((cells, targets) => {
  const wanted = targets.flatMap((sel) => { try { return [...document.querySelectorAll(sel)]; } catch { return []; } });
  const over = (el, c) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left < c.x + c.w && r.right > c.x && r.top < c.y + c.h && r.bottom > c.y; };
  const groups = new Map();
  for (const c of cells) {
    let el = document.elementFromPoint(c.x + c.w / 2, c.y + c.h / 2) || document.body;
    while (el.parentElement && el.parentElement !== document.body && getComputedStyle(el).display.startsWith('inline')) el = el.parentElement;
    const asked = wanted.some((t) => t === el || t.contains(el) || (el.contains(t) && over(t, c)));
    const g = groups.get(el) || { px: 0, asked: false };
    g.px += c.px;
    g.asked = g.asked || asked;
    groups.set(el, g);
  }
  const describe = (el) => {
    if (el === document.body || el === document.documentElement) return 'the page background';
    const cls = [...el.classList].find((k) => k.length < 24 && !/[:[\]/]/.test(k));
    const text = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    return '<' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : cls ? '.' + cls : '') + '>' + (text ? ' "' + (text.length > 28 ? text.slice(0, 28) + '…' : text) + '"' : '');
  };
  return [...groups].sort((p, q) => q[1].px - p[1].px).slice(0, 8).map(([el, g]) => ({ name: describe(el), asked: g.asked }));
}).toString()})(${JSON.stringify(cells)}, ${JSON.stringify(targets)})`;

async function nameAreas(url, where, targets = [], partition) {
  if (where.whole || !where.cells.length) return { areas: ['most of the page (the layout shifted, or the background changed)'], asked: [] };
  const named = (await visit(url, (wc) => wc.executeJavaScript(NAME_AREAS(where.cells, targets)), partition).catch(() => null)) || [];
  const pick = (asked) => [...new Set(named.filter((n) => n.asked === asked).map((n) => n.name))];
  return { areas: pick(false), asked: pick(true) };
}

const PROBE = `(async () => {
  const res = performance.getEntriesByType('resource');
  const size = (r) => r.transferSize || r.encodedBodySize || r.decodedBodySize || 0;
  const sum = (test) => res.filter(test).reduce((s, r) => s + size(r), 0);
  const css = (r) => /\\.(css|scss|sass|less)(\\?|$)/.test(r.name);
  const js = (r) => !css(r) && (r.initiatorType === 'script' || /\\.(m?js|[jt]sx?|vue|svelte)(\\?|$)/.test(r.name));
  let lcp = 0, cls = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  await new Promise((r) => setTimeout(r, 300));
  return { js: sum(js), css: sum(css), requests: res.length, nodes: document.getElementsByTagName('*').length, lcp: Math.round(lcp), cls: Math.round(cls * 1000) / 1000 };
})()`;
const probe = (url, partition) => visit(url, (wc) => wc.executeJavaScript(PROBE), partition);
const measure = async (url, partition) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await probe(url, partition);
    if (m) return m;
    await sleep(400);
  }
  return null;
};

const usable = (b, root, origin, fp, list, partition = DEFAULT_PARTITION) => !!b && b.root === root && b.origin === origin && b.partition === partition && b.fingerprint === fp && (!b.shots || list.every((r) => b.shots.has(keyFor(r.route))));

let prewarming = false;
async function prewarm(root, routes, partition = DEFAULT_PARTITION) {
  const list = routes.slice(0, MAX_ROUTES);
  if (!list.length || prewarming) return;
  const origin = originOf(list[0].url);
  prewarming = true;
  let fp;
  try { fp = await fingerprintAsync(root); } finally { prewarming = false; }
  if (usable(baseline, root, origin, fp, list, partition) || usable(warming, root, origin, fp, list, partition)) return;
  const promise = shootAll(list, partition, 1).then(async (shots) => {
    if (await fingerprintAsync(root) === fp) baseline = { root, origin, partition, fingerprint: fp, shots };
    return shots;
  });
  const mine = { root, origin, partition, fingerprint: fp, promise };
  warming = mine;
  promise.catch(() => {}).finally(() => { if (warming === mine) warming = null; });
}

function begin(root, routes, perfUrl, targets = [], partition = DEFAULT_PARTITION) {
  const list = routes.slice(0, MAX_ROUTES);
  if (!list.length && !perfUrl) return null;
  const origin = originOf(list[0]?.url || perfUrl);
  const fp = list.length ? fingerprint(root) : '';
  const before = usable(baseline, root, origin, fp, list, partition) ? Promise.resolve(baseline.shots)
    : usable(warming, root, origin, fp, list, partition) ? warming.promise.then((shots) => (list.every((r) => shots.has(keyFor(r.route))) ? shots : shootAll(list, partition)))
      : shootAll(list, partition);
  const perfBefore = perfUrl ? before.then(() => measure(perfUrl, partition), () => measure(perfUrl, partition)) : Promise.resolve(null);
  return { root, origin, routes: list, before, perfUrl, perfBefore, targets, partition };
}

async function finishPerf(check) {
  if (!check.perfUrl) return null;
  const before = await check.perfBefore.catch(() => null);
  if (!before) return null;
  const after = await measure(check.perfUrl, check.partition);
  return after ? { before, after } : null;
}

async function finish(check, save, shared = true) {
  const before = await check.before;
  const routes = shared ? check.routes : check.routes.filter((r) => r.current);
  if (!routes.length) return [];
  await sleep(1500);
  const after = await shootAll(routes, check.partition);
  if (shared) baseline = { root: check.root, origin: check.origin, partition: check.partition, fingerprint: await fingerprintAsync(check.root), shots: after };
  else baseline = null;
  const results = [];
  for (const r of routes) {
    await new Promise(setImmediate);
    const key = keyFor(r.route);
    const a = before.get(key), b = after.get(key);
    if (!a || !b) continue;
    const { pct, changed, areas: where } = await compareAsync(a, b);
    let named = {};
    if (changed) {
      save(`route-${key}-before`, a.jpg);
      save(`route-${key}-after`, b.jpg);
      named = await nameAreas(r.url, where, r.current ? check.targets : [], check.partition);
    }
    results.push({ route: r.route, key, pct, changed, current: !!r.current, areas: named.areas, asked: named.asked?.length ? named.asked : undefined });
  }
  return results;
}

module.exports = { begin, finish, finishPerf, prewarm, shoot, compare, compareAsync, nameAreas, visit, measure, keyFor, captureIds };
