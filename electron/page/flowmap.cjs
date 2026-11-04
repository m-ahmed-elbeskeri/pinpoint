// User flows: follow the site's own links from a starting page and report how pages connect,
// which links are broken and which pages lead nowhere. Pages load in hidden windows, like the sweep.
const { BrowserWindow } = require('electron');
const { captureIds, PARTITION } = require('./routecheck.cjs');
const { sleep } = require('../fsutil.cjs');

const MAX_PAGES = 30;
const LOAD_TIMEOUT_MS = 15000;
const SETTLE_MS = 700;
const THUMB_WIDTH = 240;

// Runs in the page: the links it offers, with their text and where they sit.
function pageLinks() {
  const out = [];
  const seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    if (a.closest('[data-pinpoint-ui]') || a.origin !== location.origin || /^(javascript|mailto|tel):/i.test(a.getAttribute('href') || '')) continue;
    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const to = a.pathname + a.search;
    if (to === location.pathname + location.search || seen.has(to)) continue;
    seen.add(to);
    const text = (a.innerText || a.getAttribute('aria-label') || a.getAttribute('title') || a.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
    const where = a.closest('nav, header') ? 'nav' : a.closest('footer') ? 'footer' : 'content';
    out.push({ to, text: text.slice(0, 40), where });
    if (out.length >= 60) break;
  }
  return { title: document.title, links: out };
}

const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

async function visit(url, partition) {
  const win = new BrowserWindow({
    show: false, frame: false, useContentSize: true, width: 1280, height: 800,
    webPreferences: { partition, offscreen: true, backgroundThrottling: false },
  });
  const wc = win.webContents;
  captureIds.add(wc.id);
  let status = 0;
  wc.on('did-navigate', (_e, _url, code) => { status = code || status; });
  try {
    wc.setAudioMuted(true);
    await Promise.race([win.loadURL(url), sleep(LOAD_TIMEOUT_MS).then(() => { throw new Error('took more than 15 seconds to load'); })]);
    await sleep(SETTLE_MS);
    const found = await wc.executeJavaScript(`(${pageLinks.toString()})()`);
    const img = await wc.capturePage();
    return {
      status, title: found.title, links: found.links, finalPath: pathOf(wc.getURL()),
      thumb: img.isEmpty() ? undefined : `data:image/jpeg;base64,${img.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(70).toString('base64')}`,
    };
  } catch (err) {
    return { status, error: String(err.message || err).split('\n')[0], links: [] };
  } finally {
    captureIds.delete(wc.id);
    if (!win.isDestroyed()) win.destroy();
  }
}

let current = null;

async function run({ start, partition = PARTITION, onEvent }) {
  if (current) current.stopped = true;
  const job = { stopped: false };
  current = job;
  const origin = new URL(start).origin;
  const first = pathOf(start);
  const queue = [{ path: first, depth: 0 }];
  const known = new Set([first]);
  let done = 0;
  onEvent({ type: 'start', start: first });
  const worker = async () => {
    for (let item = queue.shift(); item && !job.stopped; item = queue.shift()) {
      const r = await visit(origin + item.path, partition);
      if (job.stopped) return;
      done++;
      // A redirect (to a login page, say) is its own page: note where it went.
      const redirected = r.finalPath && r.finalPath !== item.path ? r.finalPath : undefined;
      onEvent({ type: 'page', page: { path: item.path, depth: item.depth, status: r.status, error: r.error, title: r.title, thumb: r.thumb, links: r.links, redirected }, done, total: known.size });
      for (const l of r.links) {
        if (known.has(l.to) || known.size >= MAX_PAGES) continue;
        known.add(l.to);
        queue.push({ path: l.to, depth: item.depth + 1 });
      }
    }
  };
  // A worker that finds the queue empty stops; the other keeps going with whatever its page adds.
  await Promise.all([worker(), worker(), worker()]);
  if (current === job) current = null;
  onEvent({ type: 'done', stopped: job.stopped, capped: known.size >= MAX_PAGES });
}

function stop() {
  if (current) current.stopped = true;
  current = null;
}

module.exports = { run, stop, MAX_PAGES };
