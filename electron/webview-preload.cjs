// Runs inside every page shown in Pinpoint's browser (isolated world).
// Draws the hover highlight + numbered markers in a closed shadow root and
// reports picked elements to the host via ipcRenderer.sendToHost.
const { ipcRenderer } = require('electron');

let mode = 'browse';
let hoverEl = null;
let hoverStack = []; // children we climbed out of with ArrowUp, for ArrowDown
let markers = [];    // [{uid, n, color, active}]
let hidden = false;
let uidSeq = 0;
let ui = null;

const ACCENT = '#ff4f3a'; // markup red: readable on light and dark pages

// ---------- overlay UI ----------
function ensureUI() {
  if (ui && ui.host.isConnected) return ui;
  const host = document.createElement('pinpoint-overlay');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;display:block;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .box{position:fixed;box-sizing:border-box;pointer-events:none;border-radius:3px;transition:all .06s ease-out}
      .hover{border:1.5px solid ${ACCENT};background:${ACCENT}1f}
      .label{position:fixed;pointer-events:none;font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:${ACCENT};
        padding:4px 6px;border-radius:4px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
      .label .dim{opacity:.75;font-weight:500;margin-left:6px}
      .mark{border:2px solid var(--c);background:color-mix(in srgb,var(--c) 10%,transparent)}
      .mark.active{box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 30%,transparent)}
      .badge{position:fixed;pointer-events:none;min-width:20px;height:20px;border-radius:10px;background:var(--c);color:#fff;
        font:700 11px/20px ui-sans-serif,system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box;
        box-shadow:0 2px 6px rgba(0,0,0,.35);border:1.5px solid #fff}
    </style>
    <div id="marks"></div>
    <div class="box hover" id="hover" hidden></div>
    <div class="label" id="label" hidden></div>`;
  (document.body || document.documentElement).appendChild(host);
  ui = { host, root, hover: root.getElementById('hover'), label: root.getElementById('label'), marks: root.getElementById('marks') };
  return ui;
}

function place(el, r) {
  el.style.left = r.left + 'px';
  el.style.top = r.top + 'px';
  el.style.width = r.width + 'px';
  el.style.height = r.height + 'px';
}

function describeShort(el) {
  let s = el.tagName.toLowerCase();
  if (el.id) s += '#' + el.id;
  const cls = [...el.classList].slice(0, 2);
  if (cls.length) s += '.' + cls.join('.');
  return s;
}

function renderHover() {
  const u = ensureUI();
  if (hidden || mode !== 'select' || !hoverEl || !hoverEl.isConnected) {
    u.hover.hidden = true; u.label.hidden = true; return;
  }
  const r = hoverEl.getBoundingClientRect();
  u.hover.hidden = false; place(u.hover, r);
  u.label.hidden = false;
  u.label.innerHTML = '';
  u.label.append(describeShort(hoverEl));
  const dim = document.createElement('span');
  dim.className = 'dim';
  dim.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
  u.label.append(dim);
  const above = r.top > 26;
  u.label.style.left = Math.max(4, Math.min(r.left, innerWidth - 200)) + 'px';
  u.label.style.top = (above ? r.top - 24 : Math.min(r.bottom + 4, innerHeight - 24)) + 'px';
}

function renderMarkers() {
  const u = ensureUI();
  u.marks.style.display = hidden ? 'none' : '';
  // Rebuild only when the set changes; positions are updated every frame.
  if (u.marks.childElementCount !== markers.length * 2) {
    u.marks.innerHTML = '';
    for (const m of markers) {
      const box = document.createElement('div'); box.className = 'box mark';
      const badge = document.createElement('div'); badge.className = 'badge';
      u.marks.append(box, badge);
    }
  }
  markers.forEach((m, i) => {
    const box = u.marks.children[i * 2];
    const badge = u.marks.children[i * 2 + 1];
    const el = document.querySelector(`[data-pinpoint="${m.uid}"]`);
    box.style.setProperty('--c', m.color || ACCENT);
    badge.style.setProperty('--c', m.color || ACCENT);
    box.classList.toggle('active', !!m.active);
    badge.textContent = m.n;
    if (!el) { box.hidden = true; badge.hidden = true; return; }
    const r = el.getBoundingClientRect();
    box.hidden = false; badge.hidden = false;
    place(box, r);
    badge.style.left = Math.max(2, r.left - 10) + 'px';
    badge.style.top = Math.max(2, r.top - 10) + 'px';
  });
}

function loop() {
  if (markers.length || mode === 'select') { renderMarkers(); renderHover(); }
  requestAnimationFrame(loop);
}

// ---------- element info ----------
const STYLE_KEYS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'background-image',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'border', 'border-radius',
  'box-shadow', 'opacity', 'gap', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'z-index',
];
const BORING = new Set(['none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'static', 'visible', '1', '0px none rgb(0, 0, 0)']);

function styles(el) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const k of STYLE_KEYS) {
    const v = cs.getPropertyValue(k);
    if (v && !BORING.has(v)) out[k] = v.length > 120 ? v.slice(0, 120) + '…' : v;
  }
  return out;
}

function stableClass(c) {
  // Skip utility variants and hashed CSS-module / styled-components names.
  return !/[:[\]/@!]/.test(c) && !/^(css|sc|jsx|svelte|emotion)-[a-z0-9]+$/i.test(c) && !/__[a-zA-Z0-9]{5,}$/.test(c) && c.length < 40;
}

function selectorFor(el) {
  if (el.id && !/^[:\d]|[:.]/.test(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
    let part = cur.tagName.toLowerCase();
    const testId = cur.getAttribute('data-testid');
    if (cur.id && !/^[:\d]|[:.]/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
    if (testId) part += `[data-testid="${testId}"]`;
    else {
      const cls = [...cur.classList].filter(stableClass).slice(0, 2);
      if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
    }
    const parent = cur.parentElement;
    if (parent) {
      const same = [...parent.children].filter((c) => c.tagName === cur.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
    }
    parts.unshift(part);
    const sel = parts.join(' > ');
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch { /* keep climbing */ }
    cur = parent;
  }
  return parts.join(' > ');
}

function domPath(el) {
  const chain = [];
  for (let c = el; c && c.nodeType === 1 && chain.length < 7; c = c.parentElement) chain.unshift(describeShort(c));
  return chain.join(' > ');
}

function cleanHtml(el) {
  const clone = el.cloneNode(true);
  clone.removeAttribute?.('data-pinpoint');
  clone.querySelectorAll?.('[data-pinpoint]').forEach((n) => n.removeAttribute('data-pinpoint'));
  clone.querySelectorAll?.('svg').forEach((s) => { s.innerHTML = '…'; });
  let html = clone.outerHTML.replace(/\s(style|d|srcset)="[^"]{120,}"/g, ' $1="…"').replace(/\s+/g, ' ');
  if (html.length > 1800) html = html.slice(0, 1800) + ' …';
  return html;
}

function tagElement(el) {
  let uid = el.getAttribute('data-pinpoint');
  if (!uid) { uid = `p${Date.now().toString(36)}${(uidSeq++).toString(36)}`; el.setAttribute('data-pinpoint', uid); }
  return uid;
}

// Styles worth sending for elements under a drawing: enough to act on "less loud"
// or "more space" without the full set a direct pick gets.
const HIT_STYLE_KEYS = new Set(['display', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight', 'border', 'border-radius', 'gap', 'box-shadow', 'opacity']);

// detail: true = everything (direct pick), 'hit' = compact (under a drawing), false = identity only.
function info(el, detail = true) {
  const r = el.getBoundingClientRect();
  const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const base = {
    uid: tagElement(el),
    selector: selectorFor(el),
    tag: el.tagName.toLowerCase(),
    text: text.length > 160 ? text.slice(0, 160) + '…' : text,
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
  };
  if (!detail) return base;
  const all = styles(el);
  return {
    ...base,
    id: el.id || undefined,
    classes: [...el.classList].slice(0, 16),
    path: domPath(el),
    ...(detail === 'hit'
      ? { styles: Object.fromEntries(Object.entries(all).filter(([k]) => HIT_STYLE_KEYS.has(k))) }
      : { html: cleanHtml(el), styles: all }),
  };
}

// ---------- picking ----------
function isOurs(el) { return el && ui && (el === ui.host || ui.host.contains(el)); }

function targetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return !el || isOurs(el) ? null : el;
}

function onMove(e) {
  if (mode !== 'select') return;
  const el = targetAt(e.clientX, e.clientY);
  if (el && el !== hoverEl && !(hoverStack.length && hoverStack[0].contains(el) && hoverEl.contains(el))) {
    hoverEl = el; hoverStack = [];
  }
}

function swallow(e) {
  if (mode !== 'select') return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

function onClick(e) {
  if (mode !== 'select') return;
  swallow(e);
  const el = hoverEl || targetAt(e.clientX, e.clientY);
  if (!el) return;
  const payload = info(el);
  hidden = true; renderHover(); renderMarkers();
  // Two frames so the capture the host takes next doesn't include our overlay.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ipcRenderer.sendToHost('picked', { ...payload, dpr: devicePixelRatio, viewport: { width: innerWidth, height: innerHeight }, shift: e.shiftKey });
  }));
}

function onKey(e) {
  if (e.key === 'Escape') ipcRenderer.sendToHost('key', 'Escape');
  if (mode !== 'select' || !hoverEl) return;
  if (e.key === 'ArrowUp' && hoverEl.parentElement && hoverEl.parentElement !== document.documentElement) {
    hoverStack.unshift(hoverEl); hoverEl = hoverEl.parentElement; e.preventDefault();
  } else if (e.key === 'ArrowDown' && hoverStack.length) {
    hoverEl = hoverStack.shift(); e.preventDefault();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    onClick({ preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, shiftKey: e.shiftKey, clientX: 0, clientY: 0 });
  }
}

for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick', 'submit']) {
  window.addEventListener(t, swallow, true);
}
window.addEventListener('click', onClick, true);
window.addEventListener('mousemove', onMove, true);
window.addEventListener('keydown', onKey, true);
window.addEventListener('mouseleave', () => { if (mode === 'select') { hoverEl = null; } });

// Keyboard shortcuts should work even while focus is inside the page.
window.addEventListener('keydown', (e) => {
  const tag = (e.target && e.target.tagName) || '';
  const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (['v', 's', 'd', 'k'].includes(e.key.toLowerCase())) {
    ipcRenderer.sendToHost('key', e.key.toLowerCase());
  }
}, true);

// ---------- host commands ----------
ipcRenderer.on('mode', (_e, m) => {
  mode = m;
  if (mode !== 'select') { hoverEl = null; hoverStack = []; }
  hidden = false;
  document.documentElement.style.cursor = mode === 'select' ? 'crosshair' : '';
  ensureUI();
  // The render loop idles outside select mode, so clear the hover box right now
  // or it stays frozen on the page.
  renderHover();
  renderMarkers();
});
ipcRenderer.on('markers', (_e, list) => { markers = list || []; hidden = false; ensureUI(); renderMarkers(); });
ipcRenderer.on('hide', (_e, h) => { hidden = !!h; renderMarkers(); renderHover(); });
// Hide just the hover box (markers stay); used before overview captures.
ipcRenderer.on('clean', () => { hoverEl = null; renderHover(); ipcRenderer.sendToHost('cleaned'); });
ipcRenderer.on('clear', () => {
  markers = [];
  document.querySelectorAll('[data-pinpoint]').forEach((n) => n.removeAttribute('data-pinpoint'));
  renderMarkers();
});

// Elements under a drawing: sample points -> distinct, reasonably specific elements.
ipcRenderer.on('hitTest', (_e, { reqId, points }) => {
  const seen = new Set();
  const hits = [];
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    const el = targetAt(x, y);
    if (!el || el === document.body || el === document.documentElement || seen.has(el)) continue;
    seen.add(el);
    hits.push(el);
  }
  // Prefer the innermost elements; drop ancestors of other hits.
  const specific = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o))).slice(0, 8);
  ipcRenderer.sendToHost('hits', { reqId, hits: specific.map((el) => info(el, 'hit')) });
});

ipcRenderer.on('scrollTo', (_e, uid) => {
  document.querySelector(`[data-pinpoint="${uid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

window.addEventListener('DOMContentLoaded', () => { ensureUI(); ipcRenderer.sendToHost('ready', { url: location.href }); });
requestAnimationFrame(loop);
