import { api, markerList } from './shared';
import { sleep, type PickedElement } from '../components/page/BrowserView';
import { DEVICE_OFF, type Device } from '../components/page/DeviceBar';
import type { ToolSection } from '../components/page/ElementTools';
import { fitMockup, type Overlay } from '../components/page/MockupOverlay';
import { ANNOTATION_COLORS, composite, samplePoints, uid, unionBounds } from '../lib/draw';
import type { Annotation, ForcedState, Rect, SourceInfo, Tool } from '../types';
import { useShapes } from '../lib/useShapes';
import { clampRect, errText, pinSelector, readImage, shortPath } from '../lib/util';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useAnnotations(app: AppContext) {
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ff4f3a');
  const [size, setSize] = useState(4);
  const page = useShapes();
  const sketch = useShapes();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [popover, setPopover] = useState<{ id: string; rect: Rect } | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [toolSection, setToolSection] = useState<ToolSection | null>(null);
  const [classNames, setClassNames] = useState<string[]>([]);
  const [generated, setGenerated] = useState<string[]>([]);
  const twTimer = useRef<ReturnType<typeof setTimeout>>();
  const [isolated, setIsolated] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ ok: boolean; summary?: string[]; reason?: string } | null>(null);
  const enrichSource = async (src: SourceInfo | null | undefined): Promise<SourceInfo | null> => {
    if (!src) return null;
    if (src.frame) {
      const r = await api.resolveSourceMap(src.frame).catch(() => null);
      if (r?.file) return { ...src, file: r.file, line: r.line, column: r.column };
    }
    return src;
  };
  useEffect(() => {
    app.browser.current?.send('markers', markerList(annotations.filter((a) => !a.tabId || a.tabId === app.activeTab), activeId));
  }, [annotations, activeId, app.activeTab]);
  const editKey = popover ? JSON.stringify((({ tweaks, textEdit, classEdit, reorder, propEdits, states, element }) => [tweaks, textEdit, classEdit, reorder, propEdits, states, element?.source, element?.rules?.length])(annotations.find((a) => a.id === popover.id) || ({} as Annotation))) : '';
  useEffect(() => {
    const a = popover && app.annotations.find((x) => x.id === popover.id);
    if (!a || a.kind !== 'element' || !(a.tweaks || a.textEdit || a.classEdit || a.reorder)) { setPlan(null); return; }
    let live = true;
    const t = setTimeout(() => {
      const { image: _i, ...bare } = a;
      api.instantPlan(bare).then((p) => { if (live) setPlan(p); }).catch(() => { if (live) setPlan(null); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [editKey]);
  const applyInstant = async (id: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (!a) return;
    const { image: _i, ...bare } = a;
    const runId = uid();
    try {
      const res = await api.instantApply(runId, bare);
      await releaseElement(a);
      (a.tabId ? app.handles.current[a.tabId] : app.browser.current)?.send('clear');
      setAnnotations((prev) => prev.filter((x) => x.id !== id));
      setPopover(null);
      if (!app.chatId) { app.setChatId(uid()); app.setChatCreated(Date.now()); }
      app.setChat((c) => [...c,
        { kind: 'status', id: uid(), text: `Instant edit: ${res.summary.join('; ')}` },
        { kind: 'done', id: uid(), runId, ok: true, changes: res.changes, instant: true },
      ]);
      if (/^file:/.test(app.nav.url)) app.browser.current?.reload();
      app.refreshGit();
    } catch (e) { app.flash(errText(e)); }
  };
  const onManip = (m: { uid: string; kind: 'resize' | 'reorder'; width?: string | null; height?: string | null; from?: number; to?: number; count?: number; before?: string | null }) => {
    const a = app.annotations.find((x) => x.element?.uid === m.uid);
    if (!a) return;
    if (m.kind === 'resize') {
      if (m.width) tweak(a.id, 'width', m.width);
      if (m.height) tweak(a.id, 'height', m.height);
    } else if (m.from != null && m.to != null) {
      patchAnn(a.id, (x) => ({ ...x, reorder: m.from === m.to ? undefined : { from: m.from!, to: m.to!, count: m.count || 0, before: m.before } }));
    }
    setActiveId(a.id);
  };
  const nextN = () => (app.annotations.length ? Math.max(...app.annotations.map((a) => a.n)) + 1 : 1);
  const colorFor = (n: number) => ANNOTATION_COLORS[(n - 1) % ANNOTATION_COLORS.length];
  const onPicked = useCallback(async (el: PickedElement) => {
    const n = nextN();
    const vp = el.viewport;
    const pad = 20;
    const crop = clampRect({ x: el.rect.x - pad, y: el.rect.y - pad, width: el.rect.width + pad * 2, height: el.rect.height + pad * 2 }, vp);
    const { dpr: _d, viewport: _v, shift: _s, ...element } = el;
    const ann: Annotation = { id: uid(), n, kind: 'element', note: '', color: colorFor(n), element, viewport: vp, tabId: app.activeTab, pageUrl: app.nav.url };
    setAnnotations((prev) => [...prev, ann]);
    setActiveId(ann.id);
    setToolSection(null);
    setPopover({ id: ann.id, rect: el.rect });
    try {
      if (crop.width > 2 && crop.height > 2) {
        const image = await app.browser.current!.capture(crop);
        setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, image } : a)));
      }
    } catch { /* page may have navigated */ } finally { app.browser.current?.send('hide', false); }

    const source = await enrichSource(await app.browser.current!.locateSource(el.uid));
    const wc = app.browser.current!.id();
    const [tokens, usage, rules] = await Promise.all([
      app.browser.current!.tokens(el.uid),
      source?.owner ? api.componentUsage(source.owner).catch(() => null) : null,
      wc != null ? api.matchedRules(wc, el.uid).catch(() => []) : [],
    ]);
    const component = source?.owner ? { name: source.owner, props: source.props, uses: usage?.count, fileCount: usage?.fileCount, files: usage?.files } : null;
    if (source || tokens || rules.length) {
      setAnnotations((prev) => prev.map((a) => (a.id === ann.id ? { ...a, element: { ...a.element!, source, tokens: tokens || undefined, component, rules: rules.length ? rules : undefined } } : a)));
    }
  }, []);
  const patchAnn = (id: string, fn: (a: Annotation) => Annotation) => setAnnotations((prev) => prev.map((a) => (a.id === id ? fn(a) : a)));
  const tweak = (id: string, prop: string, value: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (!a?.element) return;
    app.browser.current?.send('tweak', { uid: a.element.uid, prop, value });
    patchAnn(id, (x) => {
      const t = { ...x.tweaks };
      if (value) t[prop] = value; else delete t[prop];
      return { ...x, tweaks: Object.keys(t).length ? t : undefined };
    });
  };
  const resetTweaks = (id: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (!a?.element) return;
    for (const prop of Object.keys(a.tweaks || {})) app.browser.current?.send('tweak', { uid: a.element.uid, prop, value: '' });
    patchAnn(id, (x) => ({ ...x, tweaks: undefined }));
  };
  const setStates = async (id: string, states: ForcedState[]) => {
    const a = app.annotations.find((x) => x.id === id);
    const b = app.browser.current;
    const wc = b?.id();
    if (!a?.element || !b || wc == null) return;
    const uid = a.element.uid;
    const classes = states.flatMap((s) => (s === 'disabled' ? [] : s === 'focus' ? ['focus', 'focus-visible'] : [s]));
    try { await api.forceState(wc, pinSelector(uid), classes); } catch (e) { app.flash(errText(e)); return; }
    if (states.includes('disabled') !== !!a.states?.includes('disabled')) b.send('setDisabled', { uid, on: states.includes('disabled') });
    patchAnn(id, (x) => ({ ...x, states: states.length ? states : undefined }));
    await sleep(150);
    const fresh = await b.inspect(uid);
    if (!fresh) return;
    const pad = 20;
    const crop = clampRect({ x: fresh.rect.x - pad, y: fresh.rect.y - pad, width: fresh.rect.width + pad * 2, height: fresh.rect.height + pad * 2 }, b.size());
    let image: string | undefined;
    await b.hideMarks();
    try { if (crop.width > 2 && crop.height > 2) image = await b.capture(crop); } catch { /* keep the old close-up */ } finally { b.send('hide', false); }
    patchAnn(id, (x) => (x.element ? { ...x, image: image ?? x.image, element: { ...x.element, styles: fresh.styles, html: fresh.html, rect: fresh.rect } } : x));
  };
  const editText = (id: string, text: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (!a?.element) return;
    app.browser.current?.send('setText', { uid: a.element.uid, text });
    patchAnn(id, (x) => ({ ...x, textEdit: text === x.element!.text ? undefined : { from: x.element!.text, to: text } }));
  };
  const editClasses = (id: string, value: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (!a?.element) return;
    const from = (a.element.classes || []).join(' ');
    app.browser.current?.send('setClass', { uid: a.element.uid, value });
    patchAnn(id, (x) => ({ ...x, classEdit: value === from ? undefined : { from, to: value } }));
    const missing = value.split(/\s+/).filter((c) => c && !classNames.includes(c));
    if (!app.designSystem?.tailwind || !missing.length) return;
    clearTimeout(twTimer.current);
    twTimer.current = setTimeout(async () => {
      const want = [...new Set([...generated, ...missing])];
      try {
        const css = await api.tailwindCss(want);
        if (css == null) return;
        app.browser.current?.send('injectCss', css);
        setGenerated(want.filter((c) => css.includes(c.replace(/[^\w-]/g, (ch) => '\\' + ch))));
      } catch { /* Tailwind isn't installed or the class doesn't exist: it stays marked as pending */ }
    }, 350);
  };
  const typed = (summary: string, raw: string) => (summary.startsWith('"') ? raw : summary === 'true' || summary === 'false' ? raw === 'true' : Number(raw));
  const editProp = async (id: string, name: string, raw: string) => {
    const a = app.annotations.find((x) => x.id === id);
    const comp = a?.element?.component;
    const from = comp?.props?.[name];
    if (!a?.element || !comp || from == null) return;
    const value = typed(from, raw);
    if (typeof value === 'number' && Number.isNaN(value)) { app.flash(`${name} is a number.`); return; }
    const ok = await app.browser.current?.setProp(a.element.uid, comp.name, name, value);
    if (!ok) { app.flash("Couldn't change that prop live. It needs a React development build; reload the page and try again."); return; }
    const to = JSON.stringify(value);
    patchAnn(id, (x) => {
      const edits = { ...x.propEdits };
      if (to === from) delete edits[name]; else edits[name] = { from, to };
      return { ...x, propEdits: Object.keys(edits).length ? edits : undefined };
    });
  };
  const isolate = (id: string | null) => {
    const a = id ? app.annotations.find((x) => x.id === id) : null;
    app.browser.current?.send('isolate', a?.element?.uid || null);
    setIsolated(a ? id : null);
  };
  const openStory = async (id: string) => {
    const a = app.annotations.find((x) => x.id === id);
    const comp = a?.element?.component;
    if (!comp) return;
    try {
      const s = await api.findStory(comp.name);
      if (s.url) { setPopover(null); app.go(s.url); return; }
      if (s.file && s.canStart) {
        setPopover(null);
        app.setBusy('Starting Storybook…');
        try { const url = await api.startStorybook(comp.name); if (url) app.go(url); } finally { app.setBusy(null); }
        return;
      }
      if (s.file) { app.flash(`${s.file} exists, but Storybook isn't running and there's no "storybook" script to start it.`); return; }
      const args = Object.entries(comp.props || {}).filter(([, v]) => v !== 'ƒ').map(([k, v]) => `${k}=${v}`).join(', ');
      app.setInstruction(
        `Write a Storybook story for <${comp.name}>${a?.element?.source?.file ? ` (${shortPath(a.element.source.file, app.root)})` : ''}: a default story${args ? ` with these args: ${args}` : ''}, plus one story per meaningful variant and state. `
        + (s.storybook ? 'Follow the conventions of the existing stories.' : "Storybook isn't set up in this project: say what installing it would add and ask before doing it."),
      );
      setPopover(null);
      app.focusComposer(50);
    } catch (e) { app.flash(errText(e)); }
  };
  const releaseElement = async (a: Annotation) => {
    const b = (a.tabId && app.handles.current[a.tabId]) || app.browser.current;
    const wc = b?.id();
    if (!a.element?.uid || !b) return;
    b.send('untweak', a.element.uid);
    const comp = a.element.component;
    for (const [name, edit] of Object.entries(a.propEdits || {})) b.setProp(a.element.uid, comp?.name || '', name, JSON.parse(edit.from));
    if (a.states?.length && wc != null) await api.forceState(wc, pinSelector(a.element.uid), []).catch(() => {});
  };
  const makeDrawing = async (n: number): Promise<Annotation | null> => {
    const b = app.browser.current;
    if (!b || !page.shapes.length) return null;
    const { width, height } = b.size();
    await b.hideMarks();
    let bg: string | null = null;
    try { bg = await b.capture(); } finally { b.send('hide', false); }
    const image = await composite({ background: bg, width, height, shapes: page.shapes });
    const hits = await b.hitTest(samplePoints(page.shapes));
    const withSource = await Promise.all(hits.map(async (h) => ({ ...h, source: await enrichSource(await b.locateSource(h.uid)) })));
    return { id: uid(), n, kind: 'drawing', note: '', color: colorFor(n), image, region: unionBounds(page.shapes) || undefined, hits: withSource, viewport: { width, height } };
  };
  const makeSketch = async (n: number): Promise<Annotation | null> => {
    if (!sketch.shapes.length || !app.frame.current) return null;
    const width = app.frame.current.clientWidth, height = app.frame.current.clientHeight;
    const image = await composite({ background: null, width, height, shapes: sketch.shapes, board: true });
    return { id: uid(), n, kind: 'sketch', note: '', color: colorFor(n), image, viewport: { width: Math.round(width), height: Math.round(height) } };
  };
  const commitCurrent = async () => {
    app.setBusy('Capturing…');
    try {
      const ann = app.mode === 'sketch' ? await makeSketch(nextN()) : await makeDrawing(nextN());
      if (!ann) return;
      setAnnotations((prev) => [...prev, ann]);
      setActiveId(ann.id);
      (app.mode === 'sketch' ? sketch : page).reset();
      app.focusNote(ann.id);
    } finally { app.setBusy(null); }
  };
  const addReferences = async (files: File[] | FileList) => {
    const imgs = [...files].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;
    let n = nextN();
    const added: Annotation[] = [];
    for (const f of imgs) {
      try {
        const image = await readImage(f);
        added.push({ id: uid(), n, kind: 'reference', note: '', color: colorFor(n), image, name: f.name && f.name !== 'image.png' ? f.name : 'pasted image' });
        n++;
      } catch { app.flash(`Couldn't read ${f.name}`); }
    }
    if (!added.length) return;
    setAnnotations((prev) => [...prev, ...added]);
    setActiveId(added[added.length - 1].id);
    app.focusNote(added[0].id);
  };
  const diffMockup = async () => {
    const b = app.browser.current;
    if (!overlay || !b) return;
    const shot = await app.cleanCapture();
    if (!shot) { app.flash("Couldn't capture the page."); return; }
    try {
      const fitted = await fitMockup(overlay.image, shot, { x: overlay.x, y: overlay.y }, b.size().width);
      app.setCompare({ images: { before: fitted, after: shot }, labels: ['Mockup', 'Page'], title: 'Mockup vs page' });
    } catch { app.flash("Couldn't read the mockup image."); }
  };
  const captureSizes = async (id: string) => {
    const original = app.device;
    const plan: Device[] = [{ on: true, w: 390, h: 844, zoom: 'fit', touch: false }, { on: true, w: 820, h: 1180, zoom: 'fit', touch: false }, DEVICE_OFF];
    try {
      for (const d of plan) {
        app.setDevice(d);
        await sleep(1200);
        const shot = await app.cleanCapture();
        if (shot) await api.saveShot(id, `size-${d.w}`, shot);
      }
    } finally { app.setDevice(original); }
  };
  const addScribble = (points: [number, number][]) => {
    if (points.length < 2) return;
    page.set([...page.shapes, { id: uid(), tool: 'pen', color, size, points }]);
    if (!page.shapes.length) app.flash(`Mark added. It goes with your next message (press D for arrows, boxes and text).`);
  };
  const updateNote = (id: string, note: string) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, note } : a)));
  const removeAnn = (id: string) => {
    const a = app.annotations.find((x) => x.id === id);
    if (a) releaseElement(a);
    if (isolated === id) isolate(null);
    setAnnotations((prev) => prev.filter((x) => x.id !== id));
    if (popover?.id === id) setPopover(null);
  };
  const focusAnn = (a: Annotation) => {
    setActiveId(a.id);
    if (a.tabId && a.tabId !== app.activeTab && app.tabs.some((t) => t.id === a.tabId)) app.switchTab(a.tabId);
    if (a.kind === 'element' && a.element?.uid) (a.tabId ? app.handles.current[a.tabId] : app.browser.current)?.send('scrollTo', a.element.uid);
    else if (a.kind === 'element' && a.element && (!a.pageUrl || a.pageUrl === app.nav.url)) app.browser.current?.reveal(a.element.selector);
  };
  const drawShapes = app.mode === 'sketch' ? sketch : page;
  const pendingMarks = page.shapes.length + sketch.shapes.length;
  const popAnn = popover && annotations.find((a) => a.id === popover.id);
  const popoverStyle = useMemo(() => {
    if (!popover || !app.frame.current) return {};
    const fw = app.frame.current.clientWidth, fh = app.frame.current.clientHeight;
    const w = 320;
    const isEl = popAnn?.kind === 'element';
    const h = 130 + (isEl ? 94 + ((popAnn?.element?.component?.uses ?? 0) > 1 ? 30 : 0) + (toolSection ? 200 : 0) : 0);
    const below = popover.rect.y + popover.rect.height + 10;
    const top = below + h < fh ? below : Math.max(8, Math.min(popover.rect.y - h - 10, fh - h - 8));
    return { left: Math.min(Math.max(8, popover.rect.x), fw - w - 8), top, width: w };
  }, [popover, toolSection, popAnn?.kind, popAnn?.element?.component?.uses]);

  const focusNote = (id: string) => { setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-note="${id}"]`)?.focus({ preventScroll: true }), 50); };

  Object.assign(app, { focusNote, activeId, addReferences, addScribble, annotations, applyInstant, captureSizes, classNames, color, colorFor, commitCurrent, diffMockup, drawShapes, editClasses, editProp, editText, focusAnn, generated, isolate, isolated, makeDrawing, makeSketch, nextN, onManip, onPicked, openStory, overlay, page, patchAnn, pendingMarks, plan, popAnn, popover, popoverStyle, releaseElement, removeAnn, resetTweaks, setActiveId, setAnnotations, setClassNames, setColor, setOverlay, setPopover, setSize, setStates, setTool, setToolSection, size, sketch, tool, toolSection, tweak, updateNote });
}
