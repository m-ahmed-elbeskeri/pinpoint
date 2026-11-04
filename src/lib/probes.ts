// Probes that run in the page's own world (they need React's internals and the page's event timing):
// the keyboard-order overlay, render activity, and the state changes kept with a recording.
// Each is a self-contained function sent as a string, like the scripts in pagetools.ts.

export interface FocusReport {
  count: number;
  issues: { kind: 'tabindex' | 'name' | 'unreachable' | 'jump'; text: string; items: string[] }[];
}

export interface RenderReport {
  react: boolean;
  seconds: number;
  components: { name: string; count: number; same: number; identity: string[]; file?: string }[];
  slow: { name: string; ms: number; target: string }[];
  shifts: { value: number; nodes: string[] }[];
}

function probe(cmd: string): unknown {
  const w = window as any;
  let P = w.__pinpointProbe;
  if (!P) {
    P = { renders: null, tap: null, focus: null, wrapped: false };
    Object.defineProperty(w, '__pinpointProbe', { value: P, configurable: true });
  }

  const desc = (el: Element | null | undefined): string => {
    if (!el || !(el as any).tagName) return '(gone)';
    const e = el as HTMLElement;
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else {
      const cls = [...e.classList].filter((k) => k.length < 24 && !/[:[\]/]/.test(k)).slice(0, 2);
      if (cls.length) s += '.' + cls.join('.');
    }
    const text = (e.getAttribute('aria-label') || e.innerText || e.getAttribute('title') || e.getAttribute('placeholder') || '').replace(/\s+/g, ' ').trim();
    return text ? `${s} "${text.length > 32 ? text.slice(0, 32) + '…' : text}"` : s;
  };
  const layer = (key: string) => {
    let host = document.querySelector(`[data-pinpoint-probe="${key}"]`) as HTMLElement | null;
    if (!host) {
      host = document.createElement('pinpoint-probe');
      host.setAttribute('data-pinpoint-probe', key);
      host.setAttribute('data-pinpoint-ui', '');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:block;';
      (document.body || document.documentElement).appendChild(host);
    }
    return host;
  };
  const dropLayer = (key: string) => document.querySelector(`[data-pinpoint-probe="${key}"]`)?.remove();

  // React: watch every commit for the render and state probes.
  const nameOf = (t: any): string | null => (t && typeof t !== 'string' && (t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name)) || null;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const hostOf = (f: any): Element | null => {
    let d = f.child;
    while (d && typeof d.type !== 'string') d = d.child;
    return d?.stateNode instanceof Element ? d.stateNode : null;
  };
  const show = (v: unknown) => {
    try {
      if (typeof v === 'function') return 'ƒ';
      const s = JSON.stringify(v, (_k, x) => (typeof x === 'function' ? 'ƒ' : x instanceof Element ? `<${x.tagName.toLowerCase()}>` : x));
      if (s === undefined) return String(v);
      return s.length > 80 ? s.slice(0, 80) + '…' : s;
    } catch { return Object.prototype.toString.call(v); }
  };
  const sameJson = (a: unknown, b: unknown) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; } };
  const stateHooks = (f: any) => {
    const out: any[] = [];
    for (let h = f?.memoizedState; h && typeof h === 'object' && 'next' in h && out.length < 40; h = h.next) out.push(h);
    return out;
  };
  const onCommit = (root: any) => {
    const now = Date.now();
    const stack = [root?.current?.child];
    let seen = 0;
    while (stack.length && seen < 20000) {
      const f = stack.pop();
      if (!f) continue;
      seen++;
      const alt = f.alternate;
      if (COMPONENT_TAGS.has(f.tag) && alt && (f.flags & 1) === 1) {
        const name = nameOf(f.type) || 'Anonymous';
        const prev = alt.memoizedProps || {}, next = f.memoizedProps || {};
        const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
        const differ = [...keys].filter((k) => k !== 'children' && !Object.is(prev[k], next[k]));
        const hooks = stateHooks(f), oldHooks = stateHooks(alt);
        const changed: string[] = [];
        if (f.tag === 1) {
          const a = alt.memoizedState || {}, b = f.memoizedState || {};
          for (const k of Object.keys(b)) if (!Object.is(a[k], b[k])) changed.push(`${name}.state.${k}: ${show(a[k])} → ${show(b[k])}`);
        } else {
          let n = 0;
          hooks.forEach((h, i) => {
            if (!h.queue || typeof h.queue.dispatch !== 'function') return;
            n++;
            const o = oldHooks[i];
            if (o && !Object.is(o.memoizedState, h.memoizedState)) changed.push(`${name} state #${n}: ${show(o.memoizedState)} → ${show(h.memoizedState)}`);
          });
        }
        if (P.renders) {
          const r = P.renders;
          const c = r.components.get(name) || { name, count: 0, same: 0, identity: new Set(), file: f._debugSource?.fileName };
          c.count++;
          const childrenSame = Object.is(prev.children, next.children) || typeof next.children === 'string';
          if (!differ.length && !changed.length && childrenSame) c.same++;
          for (const k of differ) if ((typeof next[k] === 'function' && typeof prev[k] === 'function') || (typeof next[k] === 'object' && sameJson(prev[k], next[k]))) c.identity.add(k);
          r.components.set(name, c);
          const el = hostOf(f);
          if (el && r.flash.length < 80) r.flash.push({ el, n: c.count });
        }
        if (P.tap && changed.length) for (const line of changed) P.tap.push({ at: now, line });
      }
      if (f.sibling) stack.push(f.sibling);
      if (f.child && !(alt && f.child === alt.child)) stack.push(f.child);
    }
    if (P.tap && P.tap.length > 400) P.tap.splice(0, P.tap.length - 400);
    if (P.renders?.flash.length) P.paint();
  };
  const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (hook && !P.wrapped) {
    const orig = hook.onCommitFiberRoot;
    hook.onCommitFiberRoot = function (this: unknown, _id: unknown, root: unknown, ...rest: unknown[]) {
      if (P.renders || P.tap) { try { onCommit(root); } catch { /* an unfamiliar React build: skip this commit */ } }
      return typeof orig === 'function' ? orig.call(this, _id, root, ...rest) : undefined;
    };
    P.wrapped = true;
  }
  const hasReact = () => !!hook?.renderers?.size;

  P.paint ??= () => {
    const r = P.renders;
    if (!r || r.painting) return;
    r.painting = true;
    requestAnimationFrame(() => {
      r.painting = false;
      const host = layer('renders');
      const batch = r.flash.splice(0);
      for (const { el, n } of batch) {
        if (!el.isConnected) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1 || b.bottom < 0 || b.top > innerHeight) continue;
        const hot = n > 20 ? '#ef4444' : n > 5 ? '#f59e0b' : '#22c55e';
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;border:1.5px solid ${hot};box-sizing:border-box;border-radius:2px;transition:opacity .6s;opacity:1`;
        host.appendChild(box);
        setTimeout(() => { box.style.opacity = '0'; }, 250);
        setTimeout(() => box.remove(), 900);
      }
    });
  };

  if (cmd === 'renders:on') {
    if (!P.renders) {
      const r: any = { start: Date.now(), components: new Map(), flash: [], slow: [], shifts: [], observers: [] };
      try {
        const ev = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as any[]) {
            if (!e.interactionId || e.duration < 200 || r.slow.length > 40) continue;
            r.slow.push({ name: e.name, ms: Math.round(e.duration), target: desc(e.target) });
          }
        });
        ev.observe({ type: 'event', durationThreshold: 40 } as PerformanceObserverInit);
        r.observers.push(ev);
      } catch { /* no event timing in this engine */ }
      try {
        const ls = new PerformanceObserver((list) => {
          for (const e of list.getEntries() as any[]) {
            if (e.hadRecentInput || e.value < 0.01 || r.shifts.length > 40) continue;
            const nodes = (e.sources || []).map((s: any) => s.node).filter((n: any) => n instanceof Element);
            r.shifts.push({ value: Math.round(e.value * 1000) / 1000, nodes: nodes.slice(0, 3).map(desc) });
            for (const el of nodes) r.flash.push({ el, n: 99 });
            if (nodes.length) P.paint();
          }
        });
        ls.observe({ type: 'layout-shift' });
        r.observers.push(ls);
      } catch { /* no layout-shift entries in this engine */ }
      P.renders = r;
    }
    return true;
  }
  if (cmd === 'renders:off') {
    if (P.renders) for (const o of P.renders.observers) o.disconnect();
    P.renders = null;
    dropLayer('renders');
    return true;
  }
  if (cmd === 'renders:reset') {
    if (P.renders) { P.renders.components.clear(); P.renders.slow = []; P.renders.shifts = []; P.renders.start = Date.now(); }
    return true;
  }
  if (cmd === 'renders:report') {
    const r = P.renders;
    if (!r) return null;
    const components = [...r.components.values()]
      .sort((a: any, b: any) => b.count - a.count).slice(0, 12)
      .map((c: any) => ({ name: c.name, count: c.count, same: c.same, identity: [...c.identity].slice(0, 5), file: c.file }));
    return { react: hasReact(), seconds: Math.round((Date.now() - r.start) / 1000), components, slow: r.slow.slice(-8), shifts: r.shifts.slice(-6) };
  }

  if (cmd === 'tap:on') { P.tap = []; return hasReact(); }
  if (cmd === 'tap:off') { P.tap = null; return true; }
  if (cmd === 'tap:drain') {
    if (!P.tap) return null;
    const lines = P.tap.splice(0);
    // Keep the first "from" and last "to" of each piece of state, so typing a word is one change, not one per letter.
    const byKey = new Map<string, { from: string; to: string }>();
    for (const { line } of lines) {
      const m = /^(.*?): (.*) → (.*)$/.exec(line);
      if (!m) continue;
      const had = byKey.get(m[1]);
      byKey.set(m[1], { from: had ? had.from : m[2], to: m[3] });
    }
    return [...byKey].filter(([, v]) => v.from !== v.to).slice(0, 12).map(([k, v]) => `${k}: ${v.from} → ${v.to}`);
  }

  if (cmd === 'focus:on' || cmd === 'focus:report') {
    if (cmd === 'focus:on' && !P.focus) {
      const f: any = { items: [], queued: false };
      const redraw = () => {
        if (f.queued) return;
        f.queued = true;
        requestAnimationFrame(() => { f.queued = false; f.draw(); });
      };
      f.onScroll = redraw;
      addEventListener('scroll', redraw, { capture: true, passive: true });
      addEventListener('resize', redraw);
      let t = 0;
      f.mo = new MutationObserver((recs) => {
        if (recs.every((m) => (m.target as Element).closest?.('[data-pinpoint-ui]'))) return;
        clearTimeout(t); t = window.setTimeout(() => { f.scan(); f.draw(); }, 400);
      });
      f.mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['tabindex', 'disabled', 'hidden', 'class', 'style'] });
      P.focus = f;
    }
    const f = P.focus;
    if (!f) return null;
    f.scan ??= () => {
      const SEL = 'a[href],area[href],button,input,select,textarea,iframe,summary,[tabindex],[contenteditable=""],[contenteditable="true"],audio[controls],video[controls]';
      const shown = (el: Element) => {
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) return false;
        return (el as any).checkVisibility ? (el as any).checkVisibility({ visibilityProperty: true }) : getComputedStyle(el).visibility !== 'hidden';
      };
      const radios = new Map<string, Element>();
      const list = [...document.querySelectorAll(SEL)].filter((el) => {
        const e = el as HTMLInputElement;
        if (e.closest('[data-pinpoint-ui],[inert]') || e.disabled || e.tabIndex < 0 || e.type === 'hidden' || !shown(e)) return false;
        if (e.type === 'radio' && e.name) {
          const key = (e.form ? 'f' : '') + e.name;
          const had = radios.get(key) as HTMLInputElement | undefined;
          if (had && !e.checked) return false;
          if (had && e.checked) { radios.set(key, e); return true; }
          radios.set(key, e);
        }
        return true;
      }) as HTMLElement[];
      const positive = list.filter((el) => el.tabIndex > 0).sort((a, b) => a.tabIndex - b.tabIndex);
      f.items = [...positive, ...list.filter((el) => el.tabIndex === 0)].slice(0, 300);

      const nameFor = (el: HTMLElement) => {
        const by = el.getAttribute('aria-labelledby');
        const fromIds = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
        const input = el as HTMLInputElement;
        return (el.getAttribute('aria-label') || fromIds || el.innerText || el.getAttribute('title')
          || [...el.querySelectorAll('img[alt],svg title')].map((i) => i.getAttribute('alt') || i.textContent).join(' ')
          || (/^(submit|button|reset)$/.test(input.type) ? input.value : '')
          || (input.labels?.[0]?.innerText ?? '') || input.placeholder || '').trim();
      };
      const issues: FocusReport['issues'] = [];
      if (positive.length) issues.push({ kind: 'tabindex', text: `${positive.length} element${positive.length > 1 ? 's use' : ' uses'} a positive tabindex, so the keyboard reaches ${positive.length > 1 ? 'them' : 'it'} before everything else`, items: positive.slice(0, 4).map(desc) });
      const unnamed = f.items.filter((el: HTMLElement) => !nameFor(el));
      if (unnamed.length) issues.push({ kind: 'name', text: `${unnamed.length} focusable element${unnamed.length > 1 ? 's have' : ' has'} no name, so a screen reader announces nothing useful`, items: unnamed.slice(0, 4).map(desc) });

      const focusable = new Set(f.items);
      const reactClick = (el: any) => { const k = Object.keys(el).find((x) => x.startsWith('__reactProps$')); return !!(k && el[k]?.onClick); };
      const unreachable: Element[] = [];
      const all = document.body.querySelectorAll('*');
      for (let i = 0; i < all.length && i < 5000 && unreachable.length < 20; i++) {
        const el = all[i] as any;
        if (focusable.has(el) || el.closest('[data-pinpoint-ui]')) continue;
        if (!(el.onclick || el.hasAttribute('onclick') || reactClick(el) || el._vei?.onClick)) continue;
        if (el.closest(SEL) || el.querySelector(SEL) || !shown(el)) continue;
        unreachable.push(el);
      }
      if (unreachable.length) issues.push({ kind: 'unreachable', text: `${unreachable.length} clickable element${unreachable.length > 1 ? 's' : ''} can't be reached with the keyboard (a click handler on something that isn't a button or link)`, items: unreachable.slice(0, 4).map(desc) });

      const jumps: string[] = [];
      for (let i = 1; i < f.items.length; i++) {
        const a = f.items[i - 1].getBoundingClientRect(), b = f.items[i].getBoundingClientRect();
        if (b.top < a.top - 120 && b.bottom < a.top) jumps.push(`after ${desc(f.items[i - 1])}, focus jumps back up to ${desc(f.items[i])}`);
      }
      if (jumps.length) issues.push({ kind: 'jump', text: `The keyboard order jumps back up the page ${jumps.length} time${jumps.length > 1 ? 's' : ''}: the code order doesn't match the layout`, items: jumps.slice(0, 4) });
      f.issues = issues;
      f.bad = new Set([...positive, ...unnamed]);
    };
    f.draw ??= () => {
      const host = layer('focus');
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', String(innerWidth)); svg.setAttribute('height', String(innerHeight));
      svg.style.cssText = 'position:fixed;inset:0;overflow:visible';
      const pts: string[] = [];
      const frag = document.createDocumentFragment();
      f.items.forEach((el: HTMLElement, i: number) => {
        const b = el.getBoundingClientRect();
        const x = Math.max(9, b.left), y = Math.max(9, b.top);
        pts.push(`${x},${y}`);
        if (b.bottom < 0 || b.top > innerHeight) return;
        const bad = f.bad.has(el);
        const box = document.createElement('div');
        box.style.cssText = `position:fixed;left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px;box-sizing:border-box;border:1px dashed ${bad ? '#ef4444' : '#6366f1'};border-radius:2px`;
        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        badge.style.cssText = `position:fixed;left:${x - 9}px;top:${y - 9}px;min-width:18px;height:18px;padding:0 4px;box-sizing:border-box;border-radius:9px;background:${bad ? '#ef4444' : '#6366f1'};color:#fff;font:700 10px/18px ui-sans-serif,system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.4)`;
        frag.append(box, badge);
      });
      const line = document.createElementNS(ns, 'polyline');
      line.setAttribute('points', pts.join(' '));
      line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#6366f1'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('stroke-opacity', '.55');
      svg.appendChild(line);
      host.replaceChildren(svg, frag);
    };
    if (cmd === 'focus:on' || !f.issues) { f.scan(); f.draw(); }
    return { count: f.items.length, issues: f.issues || [] };
  }
  if (cmd === 'focus:off') {
    const f = P.focus;
    if (f) {
      f.mo.disconnect();
      removeEventListener('scroll', f.onScroll, { capture: true } as EventListenerOptions);
      removeEventListener('resize', f.onScroll);
    }
    P.focus = null;
    dropLayer('focus');
    return true;
  }
  return null;
}

type ProbeCmd = 'renders:on' | 'renders:off' | 'renders:reset' | 'renders:report' | 'tap:on' | 'tap:off' | 'tap:drain' | 'focus:on' | 'focus:off' | 'focus:report';
export const probeScript = (cmd: ProbeCmd) => `(${probe.toString()})(${JSON.stringify(cmd)})`;

export function focusInstruction(r: FocusReport) {
  const lines = r.issues.flatMap((i) => [`- ${i.text}:`, ...i.items.map((x) => `  - ${x}`)]);
  return `Fix these keyboard and screen reader problems on this page (${r.count} Tab stops):\n${lines.join('\n')}\n\nUse real buttons and links rather than click handlers on other elements, give every control a name, drop positive tabindex values, and make the order the keyboard follows match the layout.`;
}

export function renderInstruction(r: RenderReport) {
  const lines: string[] = [];
  for (const c of r.components.filter((x) => x.count >= 3 && (x.same || x.identity.length))) {
    const why = [c.same ? `${c.same} of them with no prop or state change` : '', c.identity.length ? `the props ${c.identity.join(', ')} are a new function or object each time` : ''].filter(Boolean).join('; ');
    lines.push(`- <${c.name}>${c.file ? ` (${c.file})` : ''} rendered ${c.count} times in ${r.seconds}s: ${why}`);
  }
  for (const s of r.slow) lines.push(`- A ${s.name} on ${s.target} took ${s.ms} ms before the page could respond (aim for under 200 ms)`);
  for (const s of r.shifts) lines.push(`- Layout shift of ${s.value}${s.nodes.length ? ` moving ${s.nodes.join(', ')}` : ''}`);
  return `While I used this page, Pinpoint saw these performance problems:\n${lines.join('\n')}\n\nFind the cause of each and fix it: memoize or move state down where components re-render for nothing, keep callbacks and objects stable, take heavy work out of event handlers, and reserve space for content that loads late.`;
}
