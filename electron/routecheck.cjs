// Unintended-change check: screenshots the open page and the project's other
// pages before and after a run (in hidden windows that share the browser's
// session) and reports which ones changed and where. The "after" set of one run
// is the baseline of the next, as long as no file changed in between; baselines
// are also taken ahead of time while the app is idle, so runs rarely wait.
const { BrowserWindow, nativeImage } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const snapshot = require('./snapshot.cjs');

const SIZE = { width: 1280, height: 1400 };
const LOAD_TIMEOUT_MS = 20000;
const SETTLE_MS = 800;
const NOISE_GAP_MS = 500;  // two captures this far apart tell moving content from still content
const CHANGED_PCT = 0.5;
const MIN_CHANGED_PX = 30; // more than a blinking caret
const MAX_ROUTES = 9;      // the open page plus up to 8 others
const CELL = 24;

// Animations and transitions jump to their end state, so two loads of the same page look the same.
const STILL_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

const captureIds = new Set(); // webContents ids of our hidden windows (their failed requests aren't page problems)
let baseline = null;          // { root, fingerprint, origin, shots: Map<key, { jpg, noisy }> }
let warming = null;           // a baseline being taken ahead of a run: { root, origin, fingerprint, promise }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyFor = (route) => route.replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '') || 'home';
const originOf = (url) => url.replace(/^(\w+:\/\/[^/]+).*/, '$1');

// Cheap identity of the project's files: any edit, by anyone, changes it.
function fingerprint(root) {
  const h = crypto.createHash('sha1');
  for (const rel of snapshot.walk(root).sort()) {
    try { const st = fs.statSync(path.join(root, rel)); h.update(`${rel}:${st.mtimeMs}:${st.size}\n`); } catch { /* vanished */ }
  }
  return h.digest('hex');
}

// Loads a URL in a hidden window, lets it settle, and hands the page to `use`.
const DEFAULT_PARTITION = 'persist:pinpoint';

// `partition` is the browser profile to load the page in (so a "view as" profile's login is used).
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

// ---------- comparing two screenshots ----------
// Changed pixels, bucketed into grid cells. Each cell keeps the tight bounds of
// its changed pixels, so the boxes hug what actually changed.
function cellDiff(pa, pb, width, height, ignore) {
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  const hits = new Uint16Array(cols * rows);
  const minX = new Int32Array(cols * rows).fill(width), minY = new Int32Array(cols * rows).fill(height);
  const maxX = new Int32Array(cols * rows), maxY = new Int32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) <= 60) continue;
      const c = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      hits[c]++;
      if (x < minX[c]) minX[c] = x;
      if (x > maxX[c]) maxX[c] = x;
      if (y < minY[c]) minY[c] = y;
      if (y > maxY[c]) maxY[c] = y;
    }
  }
  const cells = [];
  let px = 0;
  for (let c = 0; c < hits.length; c++) {
    if (hits[c] < 3 || ignore?.has(c)) continue;
    px += hits[c];
    cells.push({ i: c, x: minX[c], y: minY[c], w: maxX[c] - minX[c] + 1, h: maxY[c] - minY[c] + 1, px: hits[c] });
  }
  return { cells, px, total: cols * rows };
}

// Did a page change, by how much, and where. `a` and `b` are shots ({ jpg, noisy });
// cells that were moving on their own in either shot (a carousel, a clock) are left out.
// A percentage alone misses small things (a heading's color is a fraction of a
// percent of the page), so any change bigger than a blinking caret counts.
function compare(a, b) {
  const ia = nativeImage.createFromBuffer(a.jpg), ib = nativeImage.createFromBuffer(b.jpg);
  const { width, height } = ia.getSize();
  const sb = ib.getSize();
  if (width !== sb.width || height !== sb.height) return { pct: 100, changed: true, areas: { cells: [], whole: true } };
  const ignore = new Set([...(a.noisy || []), ...(b.noisy || [])]);
  const d = cellDiff(ia.toBitmap(), ib.toBitmap(), width, height, ignore);
  const pct = (d.px / (width * height)) * 100;
  // Most of the page moved: a layout shift or a background change, not a list of spots.
  const whole = d.cells.length > d.total * 0.6;
  return {
    pct: pct >= 1 ? Math.round(pct * 10) / 10 : Math.round(pct * 100) / 100,
    changed: pct >= CHANGED_PCT || whole || d.px >= MIN_CHANGED_PX,
    areas: { cells: d.cells.sort((p, q) => q.px - p.px).slice(0, 400), whole },
  };
}

// One page: two captures a moment apart. What differs between them is content
// that moves by itself, and is not held against a run.
const shoot = (url, partition) => visit(url, async (wc) => {
  const first = await wc.capturePage();
  if (first.isEmpty()) return null;
  await sleep(NOISE_GAP_MS);
  const second = await wc.capturePage();
  let noisy = [];
  const s1 = first.getSize(), s2 = second.getSize();
  if (!second.isEmpty() && s1.width === s2.width && s1.height === s2.height) {
    noisy = cellDiff(first.toBitmap(), second.toBitmap(), s1.width, s1.height).cells.map((c) => c.i);
  }
  return { jpg: first.toJPEG(82), noisy };
}, partition);

async function shootAll(routes, partition) {
  const shots = new Map();
  const queue = [...routes];
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      const shot = await shoot(r.url, partition);
      if (shot) shots.set(keyFor(r.route), shot);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return shots;
}

// ---------- naming what changed ----------
// Runs in the page: names the element under each changed box and groups the
// boxes by element. `targets` are the selectors the user pointed at; a change
// on (or inside, or right over) one of them is what they asked for, the rest
// are side effects.
const NAME_AREAS = (cells, targets) => `(${((cells, targets) => {
  const wanted = targets.flatMap((sel) => { try { return [...document.querySelectorAll(sel)]; } catch { return []; } });
  const over = (el, c) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left < c.x + c.w && r.right > c.x && r.top < c.y + c.h && r.bottom > c.y; };
  const groups = new Map();
  for (const c of cells) {
    let el = document.elementFromPoint(c.x + c.w / 2, c.y + c.h / 2) || document.body;
    // A link or a span inside a paragraph: report the paragraph.
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

// → { areas: what changed (minus what was asked for), asked: what was asked for }, both as element names.
async function nameAreas(url, where, targets = [], partition) {
  if (where.whole || !where.cells.length) return { areas: ['most of the page (the layout shifted, or the background changed)'], asked: [] };
  const named = (await visit(url, (wc) => wc.executeJavaScript(NAME_AREAS(where.cells, targets)), partition).catch(() => null)) || [];
  const pick = (asked) => [...new Set(named.filter((n) => n.asked === asked).map((n) => n.name))];
  return { areas: pick(false), asked: pick(true) };
}

// ---------- load cost ----------
// Script and style bytes, requests, DOM size, layout shift, largest paint.
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
// A few tries: a page that is mid-rebuild can fail a load.
const measure = async (url, partition) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const m = await probe(url, partition);
    if (m) return m;
    await sleep(400);
  }
  return null;
};

// ---------- baselines ----------
const usable = (b, root, origin, fp, list, partition = DEFAULT_PARTITION) => !!b && b.root === root && b.origin === origin && b.partition === partition && b.fingerprint === fp && (!b.shots || list.every((r) => b.shots.has(keyFor(r.route))));

// Take the "before" screenshots now, while nothing is running, so the next run
// doesn't have to wait for them. Does nothing when they are already current.
function prewarm(root, routes, partition = DEFAULT_PARTITION) {
  const list = routes.slice(0, MAX_ROUTES);
  if (!list.length) return;
  const origin = originOf(list[0].url);
  const fp = fingerprint(root);
  if (usable(baseline, root, origin, fp, list, partition) || usable(warming, root, origin, fp, list, partition)) return;
  const promise = shootAll(list, partition).then((shots) => {
    // Only keep it if nothing was edited while the pages were loading.
    if (fingerprint(root) === fp) baseline = { root, origin, partition, fingerprint: fp, shots };
    return shots;
  });
  const mine = { root, origin, partition, fingerprint: fp, promise };
  warming = mine;
  promise.catch(() => {}).finally(() => { if (warming === mine) warming = null; });
}

// Call when a run starts. Resolves to the "before" shots: the last run's
// "after" shots or an idle-time baseline when nothing was edited since.
// `perfUrl` (the open page) is also measured before and after, for the load-cost delta.
function begin(root, routes, perfUrl, targets = [], partition = DEFAULT_PARTITION) {
  const list = routes.slice(0, MAX_ROUTES);
  if (!list.length && !perfUrl) return null;
  const origin = originOf(list[0]?.url || perfUrl);
  const fp = list.length ? fingerprint(root) : '';
  const before = usable(baseline, root, origin, fp, list, partition) ? Promise.resolve(baseline.shots)
    : usable(warming, root, origin, fp, list, partition) ? warming.promise.then((shots) => (list.every((r) => shots.has(keyFor(r.route))) ? shots : shootAll(list, partition)))
      : shootAll(list, partition);
  // After the screenshots, so the dev server isn't compiling several pages while we time one.
  const perfBefore = perfUrl ? before.then(() => measure(perfUrl, partition), () => measure(perfUrl, partition)) : Promise.resolve(null);
  return { root, origin, routes: list, before, perfUrl, perfBefore, targets, partition };
}

// Before/after load cost of the open page.
async function finishPerf(check) {
  if (!check.perfUrl) return null;
  const before = await check.perfBefore.catch(() => null);
  if (!before) return null;
  const after = await measure(check.perfUrl, check.partition);
  return after ? { before, after } : null;
}

// Call when the run has finished. Returns one entry per page checked:
// { route, key, pct, changed, current, areas, asked } where `areas` names what
// changed on it, and hands back the before/after images of the pages that changed.
// `shared` false = the run only touched the open page's own file, so only that page is checked.
async function finish(check, save, shared = true) {
  const before = await check.before;
  const routes = shared ? check.routes : check.routes.filter((r) => r.current);
  if (!routes.length) return [];
  await sleep(1500); // let the dev server finish rebuilding
  const after = await shootAll(routes, check.partition);
  if (shared) baseline = { root: check.root, origin: check.origin, partition: check.partition, fingerprint: fingerprint(check.root), shots: after };
  else baseline = null; // some pages weren't re-shot: start fresh next time
  const results = [];
  for (const r of routes) {
    const key = keyFor(r.route);
    const a = before.get(key), b = after.get(key);
    if (!a || !b) continue;
    const { pct, changed, areas: where } = compare(a, b);
    let named = {};
    if (changed) {
      save(`route-${key}-before`, a.jpg);
      save(`route-${key}-after`, b.jpg);
      // Only on the open page is there something the user pointed at.
      named = await nameAreas(r.url, where, r.current ? check.targets : [], check.partition);
    }
    results.push({ route: r.route, key, pct, changed, current: !!r.current, areas: named.areas, asked: named.asked?.length ? named.asked : undefined });
  }
  return results;
}

module.exports = { begin, finish, finishPerf, prewarm, shoot, compare, nameAreas, visit, measure, keyFor, captureIds };
