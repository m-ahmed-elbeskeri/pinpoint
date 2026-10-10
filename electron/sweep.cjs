const { BrowserWindow } = require('electron');
const fs = require('node:fs');
const { captureIds, keyFor } = require('./routecheck.cjs');

const SIZES = [
  { id: 'phone', label: 'Phone', width: 390, height: 844 },
  { id: 'tablet', label: 'Tablet', width: 820, height: 1180 },
  { id: 'desktop', label: 'Desktop', width: 1280, height: 900 },
];
const MAX_PAGES = 12;
const LOAD_TIMEOUT_MS = 20000;
const SETTLE_MS = 900;
const THUMB_WIDTH = 300;
const STILL_CSS = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageCheck(phone) {
  const issues = [];
  const doc = document.scrollingElement || document.documentElement;
  const vw = document.documentElement.clientWidth;
  const name = (el) => {
    const one = (e) => {
      const cls = [...e.classList].filter((k) => k.length < 28 && !/[:[\]/]/.test(k)).slice(0, 2).join('.');
      return e.tagName.toLowerCase() + (e.id ? '#' + e.id : cls ? '.' + cls : '');
    };
    const parts = [one(el)];
    for (let p = el.parentElement; p && p !== document.body && parts.length < 3; p = p.parentElement) parts.unshift(one(p));
    const text = (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return parts.join(' > ') + (text ? ' "' + (text.length > 30 ? text.slice(0, 30) + '…' : text) + '"' : '');
  };
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o !== 'visible' && p.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  };
  const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('[data-pinpoint-ui]')).slice(0, 6000);

  if (doc.scrollWidth > vw + 1) {
    const wide = all.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && r.left < vw && shown(el) && !clipped(el); });
    const set = new Set(wide);
    const tops = wide.filter((el) => !set.has(el.parentElement)).slice(0, 4);
    issues.push({ type: 'overflow', text: 'The page scrolls sideways: its content is ' + doc.scrollWidth + 'px wide in a ' + vw + 'px window', nodes: tops.map(name) });
  }

  const broken = [...document.images].filter((im) => im.complete && im.naturalWidth === 0 && (im.currentSrc || im.getAttribute('src')));
  if (broken.length) issues.push({ type: 'image', text: broken.length + ' image' + (broken.length > 1 ? 's' : '') + " didn't load", nodes: broken.slice(0, 4).map((im) => name(im) + ' (' + String(im.currentSrc || im.getAttribute('src')).slice(-60) + ')') });

  const spilling = all.filter((el) => {
    if (el.children.length > 3 || el.clientWidth < 20 || el.scrollWidth <= el.clientWidth + 2) return false;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) return false;
    const cs = getComputedStyle(el);
    return cs.overflowX === 'visible' && !cs.display.startsWith('inline') && shown(el);
  });
  if (spilling.length) issues.push({ type: 'text', text: 'Text spills out of its box in ' + spilling.length + ' place' + (spilling.length > 1 ? 's' : ''), nodes: spilling.slice(0, 4).map(name) });

  if (phone) {
    const small = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link]')].filter((el) => {
      if (!shown(el) || el.disabled) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline' && el.tagName === 'A' && el.parentElement && el.parentElement.innerText.trim().length > (el.innerText || '').trim().length + 20) return false;
      const r = el.getBoundingClientRect();
      return Math.min(r.width, r.height) < 24;
    });
    if (small.length) issues.push({ type: 'tap', text: small.length + ' control' + (small.length > 1 ? 's are' : ' is') + ' smaller than 24px, hard to tap on a phone', nodes: small.slice(0, 4).map(name) });
  }

  const links = [...document.querySelectorAll('a[href]')].filter((a) => a.origin === location.origin && !/^(javascript|mailto|tel):/.test(a.getAttribute('href'))).map((a) => a.href.split('#')[0]);
  const failed = performance.getEntriesByType('resource').filter((r) => r.responseStatus >= 400 && !/favicon\.ico/.test(r.name)).map((r) => {
    let where = r.name;
    try { const u = new URL(r.name); where = u.origin === location.origin ? u.pathname + u.search : r.name; } catch (e) {}
    return r.responseStatus + ' ' + where;
  });
  return { issues, title: document.title, links: [...new Set(links)].slice(0, 60), failed: [...new Set(failed)] };
}

const AXE = (source) => `(async () => {
  ${source}
  const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] });
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').slice(0, 6)
    .map((v) => ({ type: 'a11y', text: v.help + ' (' + v.nodes.length + ' element' + (v.nodes.length > 1 ? 's' : '') + ')', nodes: v.nodes.slice(0, 3).map((n) => String(n.target[0])) }));
})()`;

const short = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

async function check(url, size, { partition, axe }) {
  const win = new BrowserWindow({
    show: false, frame: false, useContentSize: true, width: size.width, height: size.height,
    webPreferences: { partition, offscreen: true, backgroundThrottling: false },
  });
  const wc = win.webContents;
  const id = wc.id;
  captureIds.add(id);
  const errors = new Set();
  try {
    wc.setAudioMuted(true);
    wc.on('console-message', (e, level, message) => {
      const lvl = e && e.level !== undefined ? e.level : level;
      const msg = e && e.message !== undefined ? e.message : message;
      if ((lvl === 'error' || lvl === 3) && !/Electron Security Warning|favicon\.ico/.test(String(msg))) errors.add(String(msg).split('\n')[0].slice(0, 180));
    });
    await Promise.race([win.loadURL(url), sleep(LOAD_TIMEOUT_MS).then(() => { throw new Error('The page took more than 20 seconds to load'); })]);
    await wc.insertCSS(STILL_CSS).catch(() => {});
    await sleep(SETTLE_MS);
    const found = await wc.executeJavaScript(`(${pageCheck.toString()})(${size.id === 'phone'})`);
    const issues = [...found.issues];
    if (axe) { try { issues.push(...await wc.executeJavaScript(AXE(axe))); } catch {  } }
    for (const m of [...errors].slice(0, 4)) issues.push({ type: 'console', text: `Console error: ${m}` });
    for (const m of (found.failed || []).slice(0, 4)) issues.push({ type: 'request', text: `Request failed: ${m}` });
    const img = await wc.capturePage();
    const empty = img.isEmpty();
    return {
      issues, title: found.title, links: found.links,
      jpg: empty ? null : img.toJPEG(80),
      thumb: empty ? null : `data:image/jpeg;base64,${img.resize({ width: THUMB_WIDTH, quality: 'good' }).toJPEG(72).toString('base64')}`,
    };
  } catch (err) {
    return { issues: [{ type: 'load', text: `Couldn't load it: ${String(err.message || err).split('\n')[0]}` }], links: [] };
  } finally {
    captureIds.delete(id);
    if (!win.isDestroyed()) win.destroy();
  }
}

let current = null;

async function run({ pages, partition = 'persist:pinpoint', a11y = true, crawl = false, save, onEvent }) {
  if (current) current.stopped = true;
  const job = { stopped: false };
  current = job;
  let axe = null;
  if (a11y) { try { axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'); } catch {  } }
  const list = pages.slice(0, MAX_PAGES).map((p) => ({ route: p.route, url: p.url, key: keyFor(p.route), shots: [] }));
  const queue = [];
  const add = (page) => { for (const size of SIZES) queue.push({ page, size }); };
  list.forEach(add);
  let done = 0;
  const total = () => list.length * SIZES.length;
  onEvent({ type: 'start', total: total(), pages: list.map(({ route, url, key }) => ({ route, url, key, shots: [] })) });
  const worker = async () => {
    for (let item = queue.shift(); item && !job.stopped; item = queue.shift()) {
      const { page, size } = item;
      const r = await check(page.url, size, { partition, axe: size.id === 'desktop' ? axe : null });
      if (job.stopped) return;
      if (r.jpg && save) { try { save(`${page.key}-${size.id}`, r.jpg); } catch {  } }
      if (r.title && !page.title) page.title = r.title;
      const shot = { size: size.id, label: size.label, width: size.width, thumb: r.thumb || undefined, issues: r.issues };
      page.shots.push(shot);
      if (crawl && size.id === 'desktop') {
        for (const href of r.links || []) {
          if (list.length >= MAX_PAGES) break;
          const route = short(href);
          if (list.some((p) => p.url === href || p.route === route)) continue;
          const extra = { route, url: href, key: keyFor(route), shots: [] };
          list.push(extra);
          add(extra);
          onEvent({ type: 'page', total: total(), page: { route: extra.route, url: extra.url, key: extra.key, shots: [] } });
        }
      }
      done++;
      onEvent({ type: 'shot', done, total: total(), key: page.key, title: page.title, shot });
    }
  };
  await Promise.all([worker(), worker()]);
  if (current === job) current = null;
  onEvent({ type: 'done', stopped: job.stopped });
}

function stop() {
  if (current) current.stopped = true;
  current = null;
}

module.exports = { run, stop, check, pageCheck, SIZES, MAX_PAGES };
