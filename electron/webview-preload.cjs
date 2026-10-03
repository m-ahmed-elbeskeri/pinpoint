// Runs inside every page shown in Pinpoint's browser (isolated world).
// Draws the hover highlight + numbered markers in a closed shadow root and
// reports picked elements to the host via ipcRenderer.sendToHost.
const { ipcRenderer, webFrame } = require('electron');

// React only registers its renderer with a DevTools hook that exists before it
// loads. A minimal one lets Pinpoint change a component's props live.
try {
  webFrame.executeJavaScript(`(() => {
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
    let n = 0;
    const renderers = new Map();
    const noop = () => {};
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true, enumerable: false,
      value: { renderers, supportsFiber: true, isDisabled: false, inject(r) { renderers.set(++n, r); return n; },
        onCommitFiberRoot: noop, onCommitFiberUnmount: noop, onPostCommitFiberRoot: noop, onScheduleFiberRoot: noop, setStrictMode: noop, checkDCE: noop,
        on: noop, off: noop, emit: noop, sub: () => noop },
    });
  })()`);
} catch { /* no main world yet (about:blank) */ }

// Freezing a page has to hold its timers too, or a toast still dismisses itself
// and a menu still closes on its delay. Timers set by the page go through a thin
// wrapper: while frozen, timeouts wait (and run on release) and intervals skip.
try {
  webFrame.executeJavaScript(`(() => {
    if (window.__pinpointFreeze) return;
    const state = { frozen: false, held: [] };
    const wrap = (native, repeats) => function (fn, ms, ...args) {
      if (typeof fn !== 'function') return native.call(window, fn, ms, ...args);
      return native.call(window, function () {
        if (state.frozen) { if (!repeats) state.held.push(() => fn.apply(this, args)); return; }
        return fn.apply(this, args);
      }, ms);
    };
    window.setTimeout = wrap(window.setTimeout, false);
    window.setInterval = wrap(window.setInterval, true);
    Object.defineProperty(window, '__pinpointFreeze', { enumerable: false, value(on) {
      state.frozen = !!on;
      if (on) return;
      for (const run of state.held.splice(0)) { try { run(); } catch (err) { console.error(err); } }
    } });
  })()`);
} catch { /* no main world yet */ }

let mode = 'browse';
let hoverEl = null;
let hoverStack = []; // children we climbed out of with ArrowUp, for ArrowDown
let markers = [];    // [{uid, n, color, active}]
let hidden = false;
let uidSeq = 0;
let ui = null;
let frozen = false;        // page events are held back so menus, tooltips and popovers stay open
let layoutOn = true;       // box model and flex/grid overlays on the hovered element
let altDown = false;       // Alt held: measure from the selected element to the hovered one
let recording = false;     // clicks and typing are reported to the host as steps
const tweaked = new Map(); // element -> { style, props, disabled }: live edits, and what to restore

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
      .mbox,.pbox{position:fixed;box-sizing:border-box;border-style:solid;pointer-events:none}
      .mbox{border-color:rgba(246,178,107,.5)}
      .pbox{border-color:rgba(147,196,125,.5)}
      .kid{position:fixed;box-sizing:border-box;pointer-events:none;border:1px dashed #a78bfa}
      .rule{position:fixed;pointer-events:none;background:#f0f}
      .dist{position:fixed;pointer-events:none;font:700 10px/1 ui-monospace,monospace;color:#fff;background:#f0f;padding:2px 4px;border-radius:3px;transform:translate(-50%,-50%)}
      .mark.active::after,.mark.active::before{content:'';position:absolute;width:7px;height:7px;background:#fff;border:1.5px solid var(--c);border-radius:2px}
      .mark.active::after{right:-5px;bottom:-5px}
      .mark.active::before{right:-5px;top:calc(50% - 4px)}
      .drop{position:fixed;pointer-events:none;background:#2f7bff;border-radius:2px;box-shadow:0 0 0 1px #fff}
      .badge{position:fixed;pointer-events:none;min-width:20px;height:20px;border-radius:10px;background:var(--c);color:#fff;
        font:700 11px/20px ui-sans-serif,system-ui,sans-serif;text-align:center;padding:0 5px;box-sizing:border-box;
        box-shadow:0 2px 6px rgba(0,0,0,.35);border:1.5px solid #fff}
    </style>
    <div id="marks"></div>
    <div id="layout"></div>
    <div class="drop" id="drop" hidden></div>
    <div class="box hover" id="hover" hidden></div>
    <div class="label" id="label" hidden></div>`;
  (document.body || document.documentElement).appendChild(host);
  ui = { host, root, hover: root.getElementById('hover'), label: root.getElementById('label'), marks: root.getElementById('marks'), layout: root.getElementById('layout'), drop: root.getElementById('drop') };
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

// ---------- layout overlay ----------
const num = (v) => parseFloat(v) || 0;
const div = (cls, css) => { const d = document.createElement('div'); d.className = cls; d.style.cssText = css; return d; };

// A line with its length in px, between two points on the same row or column.
function ruler(parts, x1, y1, x2, y2) {
  const len = Math.round(Math.abs(x2 - x1) + Math.abs(y2 - y1));
  if (len < 1) return;
  const horizontal = y1 === y2;
  parts.push(div('rule', horizontal
    ? `left:${Math.min(x1, x2)}px;top:${y1}px;width:${Math.abs(x2 - x1)}px;height:1px`
    : `left:${x1}px;top:${Math.min(y1, y2)}px;width:1px;height:${Math.abs(y2 - y1)}px`));
  const tag = div('dist', `left:${(x1 + x2) / 2}px;top:${(y1 + y2) / 2}px`);
  tag.textContent = len;
  parts.push(tag);
}

// Distances from the selected element (a) to the hovered one (b): the gaps
// between them, or the insets when one contains the other.
function measure(parts, a, b) {
  const midY = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
  const midX = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
  const overlapY = Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
  const overlapX = Math.min(a.right, b.right) > Math.max(a.left, b.left);
  const y = overlapY ? midY : b.top + b.height / 2;
  const x = overlapX ? midX : b.left + b.width / 2;
  if (b.left >= a.right) ruler(parts, a.right, y, b.left, y);
  else if (a.left >= b.right) ruler(parts, b.right, y, a.left, y);
  else { ruler(parts, Math.min(a.left, b.left), y, Math.max(a.left, b.left), y); ruler(parts, Math.min(a.right, b.right), y, Math.max(a.right, b.right), y); }
  if (b.top >= a.bottom) ruler(parts, x, a.bottom, x, b.top);
  else if (a.top >= b.bottom) ruler(parts, x, b.bottom, x, a.top);
  else { ruler(parts, x, Math.min(a.top, b.top), x, Math.max(a.top, b.top)); ruler(parts, x, Math.min(a.bottom, b.bottom), x, Math.max(a.bottom, b.bottom)); }
}

// Margin (orange) and padding (green) of the hovered element, its flex/grid
// children, and distances from the selected element while Alt is held.
function renderLayout(u, el, r) {
  const parts = [];
  const cs = getComputedStyle(el);
  const m = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'].map((k) => Math.max(0, num(cs[k])));
  const p = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((k) => num(cs[k]));
  const b = ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'].map((k) => num(cs[k]));
  if (m.some(Boolean)) parts.push(div('mbox', `left:${r.left - m[3]}px;top:${r.top - m[0]}px;width:${r.width + m[1] + m[3]}px;height:${r.height + m[0] + m[2]}px;border-width:${m.join('px ')}px`));
  if (p.some(Boolean)) parts.push(div('pbox', `left:${r.left + b[3]}px;top:${r.top + b[0]}px;width:${r.width - b[1] - b[3]}px;height:${r.height - b[0] - b[2]}px;border-width:${p.join('px ')}px`));
  let note = '';
  if (/flex|grid/.test(cs.display)) {
    for (const kid of [...el.children].slice(0, 40)) {
      const k = kid.getBoundingClientRect();
      if (k.width && k.height) parts.push(div('kid', `left:${k.left}px;top:${k.top}px;width:${k.width}px;height:${k.height}px`));
    }
    const gap = cs.gap && cs.gap !== 'normal' && cs.gap !== '0px' ? ` · gap ${cs.gap}` : '';
    note = /grid/.test(cs.display)
      ? `grid ${cs.gridTemplateColumns.split(' ').filter(Boolean).length} col${gap}`
      : `flex ${cs.flexDirection}${gap}`;
  }
  const anchor = altDown && markers.find((x) => x.active);
  const from = anchor && document.querySelector(`[data-pinpoint="${anchor.uid}"]`);
  if (from && from !== el) measure(parts, from.getBoundingClientRect(), r);
  u.layout.replaceChildren(...parts);
  return note;
}

function renderHover() {
  const u = ensureUI();
  if (hidden || mode !== 'select' || !hoverEl || !hoverEl.isConnected) {
    u.hover.hidden = true; u.label.hidden = true; u.layout.replaceChildren(); return;
  }
  const r = hoverEl.getBoundingClientRect();
  u.hover.hidden = false; place(u.hover, r);
  // Not for the page itself or near-full-screen wrappers: tinting everything says nothing.
  const huge = hoverEl === document.body || hoverEl === document.documentElement || r.width * r.height > innerWidth * innerHeight * 0.6;
  const note = layoutOn && !huge ? renderLayout(u, hoverEl, r) : (u.layout.replaceChildren(), '');
  u.label.hidden = false;
  u.label.innerHTML = '';
  u.label.append(describeShort(hoverEl));
  const dim = document.createElement('span');
  dim.className = 'dim';
  dim.textContent = `${Math.round(r.width)}×${Math.round(r.height)}${note ? ` · ${note}` : ''}`;
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
  clone.removeAttribute?.('data-pinpoint-hover');
  clone.querySelectorAll?.('[data-pinpoint-hover]').forEach((n) => n.removeAttribute('data-pinpoint-hover'));
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
    leaf: el.children.length === 0 || undefined, // only text inside: its copy can be edited in place
    classes: [...el.classList].slice(0, 80),
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
  altDown = e.altKey;
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
  if (suppressClick) { suppressClick = false; return; } // the end of a drag, not a pick
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

// ---------- direct manipulation: resize by the edges, drag to reorder ----------
// Works on the selected element (the active pin). Its right and bottom edges
// resize it; dragging its body moves it among its siblings. Both show at once
// in the page and are reported to the host, which records them on the annotation.
let manip = null;
let suppressClick = false;
const EDGE = 7;
const activeEl = () => { const m = markers.find((x) => x.active); return m ? byUid(m.uid) : null; };

function zoneAt(el, x, y) {
  const r = el.getBoundingClientRect();
  if (x < r.left || x > r.right + EDGE || y < r.top || y > r.bottom + EDGE) return null;
  const right = Math.abs(x - r.right) <= EDGE, bottom = Math.abs(y - r.bottom) <= EDGE;
  if (right && bottom) return 'xy';
  if (right) return 'x';
  if (bottom) return 'y';
  return 'move';
}

// Where a dragged element would land: before which sibling, and where to draw the line.
function dropTarget(el, x, y) {
  const parent = el.parentElement;
  if (!parent) return null;
  const all = [...parent.children].filter((c) => !isOurs(c));
  const sibs = all.filter((c) => c !== el);
  if (!sibs.length) return null;
  // Laid out in a row when neighbours share a top edge; otherwise stacked.
  const a = all[0].getBoundingClientRect(), b = all[1].getBoundingClientRect();
  const row = Math.abs(a.top - b.top) < Math.min(a.height, b.height) / 2;
  let before = null;
  for (const s of sibs) {
    const r = s.getBoundingClientRect();
    if ((row ? x : y) < (row ? r.left + r.width / 2 : r.top + r.height / 2)) { before = s; break; }
  }
  const r = (before || sibs[sibs.length - 1]).getBoundingClientRect();
  const line = row
    ? { left: before ? r.left - 4 : r.right + 1, top: r.top, width: 3, height: r.height }
    : { left: r.left, top: before ? r.top - 4 : r.bottom + 1, width: r.width, height: 3 };
  return { before, line };
}

function manipDown(e) {
  if (mode !== 'select' || e.button !== 0) return;
  const el = activeEl();
  const zone = el && zoneAt(el, e.clientX, e.clientY);
  if (!zone) return;
  const r = el.getBoundingClientRect();
  manip = { el, zone, x: e.clientX, y: e.clientY, w: r.width, h: r.height, moved: false, target: null };
}

function manipMove(e) {
  if (mode !== 'select') return;
  if (!manip) {
    const el = activeEl();
    const z = el && zoneAt(el, e.clientX, e.clientY);
    document.documentElement.style.cursor = z === 'x' ? 'ew-resize' : z === 'y' ? 'ns-resize' : z === 'xy' ? 'nwse-resize' : z === 'move' ? 'grab' : 'crosshair';
    return;
  }
  const dx = e.clientX - manip.x, dy = e.clientY - manip.y;
  if (!manip.moved && Math.hypot(dx, dy) < 5) return;
  manip.moved = true;
  const u = ensureUI();
  if (manip.zone === 'move') {
    manip.target = dropTarget(manip.el, e.clientX, e.clientY);
    u.drop.hidden = !manip.target;
    if (manip.target) place(u.drop, manip.target.line);
    return;
  }
  const rec = tweakRecord(manip.el);
  if (manip.zone !== 'y') rec.props.set('width', Math.max(8, Math.round(manip.w + dx)) + 'px');
  if (manip.zone !== 'x') rec.props.set('height', Math.max(8, Math.round(manip.h + dy)) + 'px');
  applyTweaks(manip.el, rec);
}

function manipUp() {
  if (!manip) return;
  const m = manip;
  manip = null;
  ensureUI().drop.hidden = true;
  if (!m.moved) return; // a plain click: handled as a pick
  suppressClick = true;
  setTimeout(() => { suppressClick = false; }, 80);
  const uid = m.el.getAttribute('data-pinpoint');
  const rec = tweakRecord(m.el);
  if (m.zone !== 'move') {
    ipcRenderer.sendToHost('manip', { uid, kind: 'resize', width: m.zone !== 'y' ? rec.props.get('width') : null, height: m.zone !== 'x' ? rec.props.get('height') : null });
    return;
  }
  if (!m.target) return;
  const parent = m.el.parentElement;
  const kids = () => [...parent.children].filter((c) => !isOurs(c));
  // Remember where it started (once), so the move can be undone and reported from the original position.
  if (!rec.order) rec.order = { parent, next: m.el.nextElementSibling, from: kids().indexOf(m.el) };
  parent.insertBefore(m.el, m.target.before);
  const now = kids();
  const next = m.el.nextElementSibling;
  const label = next ? describeShort(next) + ((next.innerText || '').trim() ? ' "' + next.innerText.trim().replace(/\s+/g, ' ').slice(0, 30) + '"' : '') : null;
  ipcRenderer.sendToHost('manip', { uid, kind: 'reorder', from: rec.order.from, to: now.indexOf(m.el), count: now.length, before: label });
}

// Registered before the listeners that swallow page input in select mode, so these still see it.
window.addEventListener('pointerdown', manipDown, true);
window.addEventListener('pointermove', manipMove, true);
window.addEventListener('pointerup', manipUp, true);

for (const t of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick', 'submit']) {
  window.addEventListener(t, swallow, true);
}
window.addEventListener('click', onClick, true);
window.addEventListener('mousemove', onMove, true);
window.addEventListener('keydown', onKey, true);
window.addEventListener('mouseleave', () => { if (mode === 'select') { hoverEl = null; } });

// ---------- freeze ----------
// Holds transient UI open so it can be picked: page scripts stop hearing the
// events that would close it, and the host forces :hover on what was hovered.
function setFrozen(on, fromPage) {
  if (on === frozen) return;
  frozen = on;
  if (on) document.querySelectorAll(':hover').forEach((el) => { if (!isOurs(el)) el.setAttribute('data-pinpoint-hover', ''); });
  try { webFrame.executeJavaScript(`window.__pinpointFreeze && window.__pinpointFreeze(${on ? 'true' : 'false'})`); } catch { /* page is gone */ }
  // When unfreezing, the marks stay until the host has released :hover and sends 'thaw'.
  if (fromPage) ipcRenderer.sendToHost('frozen', on);
}

// Keyboard shortcuts should work even while focus is inside the page.
window.addEventListener('keydown', (e) => {
  if (e.key === 'F8') { setFrozen(!frozen, true); e.preventDefault(); return; } // works while typing too
  const tag = (e.target && e.target.tagName) || '';
  const typing = /INPUT|TEXTAREA|SELECT/.test(tag) || (e.target && e.target.isContentEditable);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') setFrozen(!frozen, true);
  else if (['v', 's', 'd', 'k'].includes(k)) ipcRenderer.sendToHost('key', k);
}, true);

// Registered after our own listeners, so picking still works on a frozen page.
function hold(e) {
  if (!frozen) return;
  e.stopImmediatePropagation();
  if (/^(click|dblclick|auxclick|contextmenu|mousedown|pointerdown|submit|keydown)$/.test(e.type) && e.cancelable) e.preventDefault();
}
for (const t of [
  'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'mousemove', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave', 'pointermove',
  'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'submit',
  'focus', 'blur', 'focusin', 'focusout', 'keydown', 'keyup', 'keypress', 'wheel', 'scroll', 'touchstart', 'touchend', 'visibilitychange',
]) {
  window.addEventListener(t, hold, true);
}
document.addEventListener('visibilitychange', hold, true);

// ---------- live tweaks ----------
const byUid = (uid) => document.querySelector(`[data-pinpoint="${uid}"]`);

function tweakRecord(el) {
  let rec = tweaked.get(el);
  if (!rec) tweaked.set(el, rec = { style: el.getAttribute('style'), props: new Map(), disabled: null, text: null, cls: null, order: null });
  return rec;
}

// Inline !important styles win over the page's own, so the user sees the result
// instantly. The original style attribute is put back when the tweak is dropped.
function applyTweaks(el, rec) {
  if (rec.style == null) el.removeAttribute('style'); else el.setAttribute('style', rec.style);
  for (const [prop, value] of rec.props) el.style.setProperty(prop, value, 'important');
  if (rec.style == null && !el.getAttribute('style')) el.removeAttribute('style');
}

function untweak(el) {
  const rec = tweaked.get(el);
  if (!rec) return;
  rec.props.clear();
  if (el.isConnected) {
    applyTweaks(el, rec);
    if (rec.disabled != null) el.toggleAttribute('disabled', rec.disabled);
    if (rec.text != null) el.textContent = rec.text;
    if (rec.cls != null) el.setAttribute('class', rec.cls);
    if (rec.order && rec.order.parent.isConnected) rec.order.parent.insertBefore(el, rec.order.next && rec.order.next.parentElement === rec.order.parent ? rec.order.next : null);
  }
  tweaked.delete(el);
}

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
ipcRenderer.on('tweak', (_e, { uid, prop, value }) => {
  const el = byUid(uid);
  if (!el) return;
  const rec = tweakRecord(el);
  if (value) rec.props.set(prop, value); else rec.props.delete(prop);
  applyTweaks(el, rec);
});
ipcRenderer.on('setDisabled', (_e, { uid, on }) => {
  const el = byUid(uid);
  if (!el) return;
  const rec = tweakRecord(el);
  if (rec.disabled == null) rec.disabled = el.hasAttribute('disabled');
  el.toggleAttribute('disabled', on ? true : rec.disabled);
});
// Copy and class edits, shown live like style tweaks and restored the same way.
ipcRenderer.on('setText', (_e, { uid, text }) => {
  const el = byUid(uid);
  if (!el || el.children.length) return;
  const rec = tweakRecord(el);
  if (rec.text == null) rec.text = el.textContent;
  el.textContent = text;
});
ipcRenderer.on('setClass', (_e, { uid, value }) => {
  const el = byUid(uid);
  if (!el) return;
  const rec = tweakRecord(el);
  if (rec.cls == null) rec.cls = el.getAttribute('class') || '';
  el.setAttribute('class', value);
});
// Drop the live edits of one element, or of all of them.
ipcRenderer.on('untweak', (_e, uid) => {
  if (uid) { const el = byUid(uid); if (el) untweak(el); } else for (const el of [...tweaked.keys()]) untweak(el);
});
// Fresh info for an element that is already tagged (after forcing a state on it).
ipcRenderer.on('inspect', (_e, { reqId, uid }) => {
  const el = byUid(uid);
  ipcRenderer.sendToHost('reply', { reqId, data: el ? info(el) : null });
});
ipcRenderer.on('freeze', (_e, on) => setFrozen(!!on, false));
ipcRenderer.on('thaw', () => {
  document.querySelectorAll('[data-pinpoint-hover]').forEach((n) => n.removeAttribute('data-pinpoint-hover'));
});

ipcRenderer.on('clear', () => {
  markers = [];
  for (const el of [...tweaked.keys()]) untweak(el);
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

ipcRenderer.on('layout', (_e, on) => { layoutOn = !!on; renderHover(); });

// Light / dark for sites that switch theme with a class or attribute rather than
// the prefers-color-scheme media query (which the host emulates separately).
const THEME_ATTRS = ['data-theme', 'data-mode', 'data-color-mode', 'data-color-scheme', 'data-bs-theme', 'data-mui-color-scheme', 'data-mantine-color-scheme'];
let themeSaved = null;
ipcRenderer.on('scheme', (_e, mode) => {
  const html = document.documentElement, body = document.body;
  if (!themeSaved && !mode) return;
  if (!themeSaved) themeSaved = { cls: html.className, body: body ? body.className : '', attrs: THEME_ATTRS.map((a) => [a, html.getAttribute(a)]) };
  // Back to how the page had it, then apply the asked-for theme on top.
  html.className = themeSaved.cls;
  if (body) body.className = themeSaved.body;
  for (const [a, v] of themeSaved.attrs) { if (v == null) html.removeAttribute(a); else html.setAttribute(a, v); }
  if (!mode) { themeSaved = null; return; }
  const other = mode === 'dark' ? 'light' : 'dark';
  for (const el of [html, body]) {
    if (!el) continue;
    const had = el.classList.contains(other) || el === html;
    el.classList.remove(other, `chakra-ui-${other}`, `theme-${other}`);
    if (had) el.classList.add(mode);
    if (el.className.includes('chakra-ui')) el.classList.add(`chakra-ui-${mode}`);
  }
  for (const a of THEME_ATTRS) if (html.hasAttribute(a)) html.setAttribute(a, mode);
});
window.addEventListener('keyup', (e) => { if (e.key === 'Alt') altDown = false; }, true);

// ---------- content stress tests ----------
// Temporary rewrites of what the page shows, to see how the layout copes. All
// of them are undone when switched off (or by a reload).
const stress = { texts: new Map(), dir: null, on: new Set() };
const ACCENTS = { a: 'á', e: 'é', i: 'í', o: 'ö', u: 'ü', c: 'ç', n: 'ñ', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ö', U: 'Ü', C: 'Ç', N: 'Ñ' };

function pageStyle() {
  let s = document.querySelector('style[data-pinpoint-style]');
  if (!s) {
    s = document.createElement('style');
    s.setAttribute('data-pinpoint-style', '');
    s.textContent = '[data-pinpoint-empty]{display:none!important}'
      // Isolate: everything outside the element is removed from layout, its ancestors
      // keep only what it inherits from them (display: contents), and it sits centered.
      + 'html[data-pinpoint-isolate] body{display:grid!important;place-items:center!important;min-height:100vh!important;margin:0!important;padding:32px!important;box-sizing:border-box!important}'
      + 'html[data-pinpoint-isolate] [data-pinpoint-iso-path]{display:contents!important}'
      + 'html[data-pinpoint-isolate] body *:not([data-pinpoint-iso-path]):not([data-pinpoint-iso]):not([data-pinpoint-iso] *):not(pinpoint-overlay){display:none!important}';
    (document.head || document.documentElement).appendChild(s);
  }
}

function textNodes() {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && out.length < 4000; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || !n.textContent.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|TITLE)$/.test(parent.tagName) || isOurs(parent)) continue;
    out.push(n);
  }
  return out;
}

function applyStress() {
  for (const [n, t] of stress.texts) if (n.isConnected) n.textContent = t;
  stress.texts.clear();
  if (stress.on.has('long') || stress.on.has('pseudo')) {
    for (const n of textNodes()) {
      const orig = n.textContent;
      let t = orig;
      if (stress.on.has('pseudo')) t = t.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] || c) + (t.trim().length > 3 ? ' ·····' : '');
      if (stress.on.has('long')) t = `${t} ${t.trim()} ${t.trim()}`;
      stress.texts.set(n, orig);
      n.textContent = t;
    }
  }
  const html = document.documentElement;
  if (stress.on.has('rtl')) { if (stress.dir == null) stress.dir = html.getAttribute('dir') || ''; html.setAttribute('dir', 'rtl'); }
  else if (stress.dir != null) { if (stress.dir) html.setAttribute('dir', stress.dir); else html.removeAttribute('dir'); stress.dir = null; }

  document.querySelectorAll('[data-pinpoint-empty]').forEach((n) => n.removeAttribute('data-pinpoint-empty'));
  if (stress.on.has('empty')) {
    pageStyle();
    // Lists, table bodies, and any container whose children repeat the same shape.
    const sig = (c) => `${c.tagName}.${[...c.classList].sort().join('.')}`;
    for (const box of document.body.querySelectorAll('*')) {
      if (isOurs(box) || box.children.length < 2) continue;
      const kids = [...box.children];
      const listy = box.matches('ul,ol,tbody,[role=list],[role=listbox],[role=grid],[role=feed],[role=rowgroup]');
      if (listy || (kids.length >= 3 && kids.every((k) => sig(k) === sig(kids[0])))) kids.forEach((k) => k.setAttribute('data-pinpoint-empty', ''));
    }
  }
}
ipcRenderer.on('stress', (_e, kinds) => { stress.on = new Set(kinds || []); applyStress(); });

// Show one element on its own, still live: the rest of the page drops out of
// layout (nothing is removed, so component state survives) and it is centered.
ipcRenderer.on('isolate', (_e, uid) => {
  document.querySelectorAll('[data-pinpoint-iso],[data-pinpoint-iso-path]').forEach((n) => { n.removeAttribute('data-pinpoint-iso'); n.removeAttribute('data-pinpoint-iso-path'); });
  const el = uid && byUid(uid);
  document.documentElement.toggleAttribute('data-pinpoint-isolate', !!el);
  if (!el) return;
  pageStyle();
  el.setAttribute('data-pinpoint-iso', '');
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) p.setAttribute('data-pinpoint-iso-path', '');
});

// CSS generated for classes the page's build hasn't emitted yet (new Tailwind utilities).
ipcRenderer.on('injectCss', (_e, css) => {
  let s = document.querySelector('style[data-pinpoint-tw]');
  if (!s) { s = document.createElement('style'); s.setAttribute('data-pinpoint-tw', ''); (document.head || document.documentElement).appendChild(s); }
  s.textContent = css || '';
});

// ---------- scroll sync (side-by-side sizes) ----------
let syncedAt = 0;
let scrollQueued = false;
const scrollRoom = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
window.addEventListener('scroll', () => {
  if (scrollQueued || Date.now() - syncedAt < 250) return; // ignore the scroll we caused ourselves
  scrollQueued = true;
  requestAnimationFrame(() => { scrollQueued = false; ipcRenderer.sendToHost('scroll', scrollY / scrollRoom()); });
}, { capture: true, passive: true });
ipcRenderer.on('syncScroll', (_e, ratio) => { syncedAt = Date.now(); scrollTo(0, ratio * scrollRoom()); });

// ---------- interaction recording ----------
const ACTIONABLE = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=option],[role=checkbox],[role=switch],[onclick]';
function stepTarget(el) {
  const t = (el.closest && el.closest(ACTIONABLE)) || el;
  const text = (t.innerText || t.getAttribute('aria-label') || t.getAttribute('placeholder') || t.getAttribute('name') || '').replace(/\s+/g, ' ').trim();
  return { selector: selectorFor(t), tag: t.tagName.toLowerCase(), text: text.slice(0, 60) };
}
window.addEventListener('click', (e) => {
  if (!recording || mode === 'select' || isOurs(e.target)) return;
  ipcRenderer.sendToHost('step', { type: 'click', ...stepTarget(e.target) });
}, true);
window.addEventListener('change', (e) => {
  const t = e.target;
  if (!recording || !t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const secret = t.type === 'password';
  const value = t.type === 'checkbox' || t.type === 'radio' ? String(t.checked) : secret ? '••••••' : String(t.value).slice(0, 200);
  ipcRenderer.sendToHost('step', { type: t.type === 'checkbox' || t.type === 'radio' ? 'check' : 'fill', ...stepTarget(t), value, secret: secret || undefined });
}, true);
window.addEventListener('keydown', (e) => {
  if (recording && mode !== 'select' && ['Enter', 'Escape', 'Tab'].includes(e.key)) ipcRenderer.sendToHost('step', { type: 'key', key: e.key });
}, true);
ipcRenderer.on('record', (_e, on) => { recording = !!on; });

window.addEventListener('DOMContentLoaded', () => { ensureUI(); ipcRenderer.sendToHost('ready', { url: location.href }); });
requestAnimationFrame(loop);
