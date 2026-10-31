import { api } from './shared';
import { conversationText } from '../lib/chat';
import { uid } from '../lib/draw';
import { useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useSideChats(app: AppContext) {
  const [sides, setSides] = useState<{ id: string; title: string; seed: string | null; running: boolean }[]>([]);
  const [activeSide, setActiveSide] = useState<string | null>(null);
  const [askAside, setAskAside] = useState<{ text: string; x: number; y: number } | null>(null);
  // What the side chat gets to know about the main conversation: the last few requests and replies.
  const sideContext = () => {
    const page = app.nav.url ? `Page open in the browser: ${app.nav.url}\n` : '';
    return (page + conversationText(app.chat.slice(-24), 4000)).slice(-4000);
  };
  const onChatMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (!text || !sel?.rangeCount) { setAskAside(null); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    setAskAside({ text: text.slice(0, 1500), x: Math.round(r.left + r.width / 2), y: Math.round(r.top) });
  };
  const newSide = (seed?: string) => {
    if (!app.settings?.projectDir) return;
    const id = `side-${uid()}`;
    setSides((list) => [...list, { id, title: 'Side chat', seed: seed ?? null, running: false }]);
    setActiveSide(id);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
  };
  // Fade the tab strip's edges only where more tabs are hidden.
  const tabsStrip = useRef<HTMLDivElement>(null);
  const fadeTabs = () => {
    const el = tabsStrip.current;
    if (!el) return;
    el.classList.toggle('fade-l', el.scrollLeft > 2);
    el.classList.toggle('fade-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };
  useEffect(() => {
    const el = tabsStrip.current;
    if (!el) return;
    fadeTabs();
    const ro = new ResizeObserver(fadeTabs);
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => { tabsStrip.current?.querySelector('.ptab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [activeSide, sides.length]);
  const patchSide = (id: string, p: Partial<(typeof sides)[number]>) => setSides((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const closeSide = (id: string) => {
    api.sideCancel(id).catch(() => {});
    setSides((list) => list.filter((x) => x.id !== id));
    if (activeSide === id) setActiveSide(null);
  };
  // Selected text in the chat: start a side chat about it, or quote it into a reply.
  const fromSelection = (how: 'side' | 'reply') => {
    const text = askAside?.text || '';
    setAskAside(null);
    window.getSelection()?.removeAllRanges();
    if (!text) return;
    if (how === 'side') { newSide(text); return; }
    const quote = text.split('\n').map((l) => `> ${l}`).join('\n');
    app.setInstruction((v) => `${v ? v.trimEnd() + '\n\n' : ''}${quote}\n\n`);
    setActiveSide(null);
    app.focusComposer(30, true);
  };

  Object.assign(app, { activeSide, askAside, closeSide, fadeTabs, fromSelection, newSide, onChatMouseUp, patchSide, setActiveSide, setAskAside, sideContext, sides, tabsStrip });
}
