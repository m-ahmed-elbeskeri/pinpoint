// Self-contained pieces of the app shell's state: each owns its buffers and timers
// and hands back only what the shell needs.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatItem, ConsoleEntry, NetworkFailure } from './types';

const api = window.pinpoint;

type ConsoleMessage = Omit<ConsoleEntry, 'count' | 'at'>;

// Console errors and failed requests reported by the open page.
// A broken page reports them in bursts (a dev error overlay comes with dozens): they are
// collected and applied a few times a second, so the app doesn't redraw for each one.
export function usePageProblems() {
  const [consoleLog, setConsoleLog] = useState<ConsoleEntry[]>([]);
  const [netFails, setNetFails] = useState<NetworkFailure[]>([]);
  // The latest lists, for code that runs later (after a run) and must not see a stale render's copy.
  const consoleRef = useRef(consoleLog);
  consoleRef.current = consoleLog;
  const netRef = useRef(netFails);
  netRef.current = netFails;

  const buf = useRef<{ console: Omit<ConsoleEntry, 'count'>[]; network: NetworkFailure[] }>({ console: [], network: [] });
  const timer = useRef(0);
  const flush = useCallback(() => {
    timer.current = 0;
    const { console: cons, network: net } = buf.current;
    buf.current = { console: [], network: [] };
    if (net.length) setNetFails((l) => {
      const next = [...l];
      for (const n of net) if (!next.some((x) => x.url === n.url && x.status === n.status && x.error === n.error)) next.push(n);
      return next.length === l.length ? l : next.slice(-30);
    });
    if (cons.length) setConsoleLog((l) => {
      const next = [...l];
      for (const c of cons) {
        const i = next.findIndex((x) => x.message === c.message && x.level === c.level);
        if (i >= 0) next[i] = { ...next[i], count: next[i].count + 1, at: c.at };
        else next.push({ ...c, count: 1 });
      }
      return next.slice(-40);
    });
  }, []);
  const queue = useCallback(() => { timer.current ||= window.setTimeout(flush, 150); }, [flush]);

  // Failed network requests from the page.
  useEffect(() => api.onNetworkError((n) => { buf.current.network.push(n); queue(); }), [queue]);

  const onConsole = useCallback((c: ConsoleMessage) => {
    buf.current.console.push({ ...c, at: Date.now() });
    queue();
  }, [queue]);
  const clearDiagnostics = useCallback(() => { buf.current = { console: [], network: [] }; setConsoleLog([]); setNetFails([]); }, []);

  return { consoleLog, netFails, consoleRef, netRef, onConsole, clearDiagnostics };
}

// The dev server's and the agent's raw output, for the drawer.
// Terminal output can arrive hundreds of lines a second: it is collected and shown a few times a second.
export function useLogs() {
  const [devLog, setDevLog] = useState('');
  const [agentLog, setAgentLog] = useState('');
  const buf = useRef({ dev: '', agent: '' });
  const timer = useRef(0);
  const addLog = useCallback((which: 'dev' | 'agent', text: string) => {
    buf.current[which] += text;
    if (timer.current) return;
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      const { dev, agent } = buf.current;
      buf.current = { dev: '', agent: '' };
      if (dev) setDevLog((l) => (l + dev).slice(-200_000));
      if (agent) setAgentLog((l) => (l + agent).slice(-200_000));
    }, 120);
  }, []);
  return { devLog, agentLog, setDevLog, setAgentLog, addLog };
}

// Keeps the conversation at its end while it grows, unless the reader has scrolled up:
// scrolling up to read leaves it where it is. A message you send jumps back down.
// `chatEnd` goes on an empty element at the end of the scrolling box.
export function useChatScroll(chat: ChatItem[], runId: string | null, job: string | null) {
  const chatEnd = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const chatLen = useRef(0);
  // away: scrolled up from the end. fresh: something new arrived down there meanwhile.
  const [away, setAway] = useState<{ fresh: boolean } | null>(null);
  const awayRef = useRef(away);
  awayRef.current = away;
  const onChatScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Only being right at the end counts as following along: any scroll up, however small, is left alone.
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    if (stick.current ? awayRef.current : !awayRef.current) setAway(stick.current ? null : { fresh: false });
  }, []);
  // Scrolling up lets go at once, before the next line of output can pull the view back down.
  const onChatWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (e.deltaY < 0 && el.scrollHeight > el.clientHeight) { stick.current = false; if (!awayRef.current) setAway({ fresh: false }); }
  }, []);
  const toLatest = useCallback(() => {
    const box = chatEnd.current?.parentElement;
    if (!box) return;
    stick.current = true;
    setAway(null);
    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }, []);
  useLayoutEffect(() => {
    const box = chatEnd.current?.parentElement;
    if (!box) return;
    const grew = chat.length > chatLen.current;
    chatLen.current = chat.length;
    if (grew && chat[chat.length - 1]?.kind === 'user') { stick.current = true; if (awayRef.current) setAway(null); }
    if (stick.current) box.scrollTop = box.scrollHeight;
    else if (awayRef.current && !awayRef.current.fresh) setAway({ fresh: true });
  }, [chat, runId, job]);
  // Called when a different conversation is put on screen: start at its end.
  const follow = useCallback(() => { stick.current = true; }, []);
  return { chatEnd, away, onChatScroll, onChatWheel, toLatest, follow };
}

// One object of callbacks that never changes identity but always runs the latest versions,
// so memoised children aren't rendered again just because their parent was.
export function useStableActions<T extends Record<string, (...args: any[]) => any>>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  const stable = useRef<T | null>(null);
  stable.current ??= Object.fromEntries(Object.keys(handlers).map((k) => [k, (...a: unknown[]) => latest.current[k](...a)])) as T;
  return stable.current;
}
