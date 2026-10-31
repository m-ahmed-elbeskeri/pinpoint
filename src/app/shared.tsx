import { Monitor, Smartphone, Tablet } from '../components/ui/icons';
import type { Annotation } from '../types';

export const api = window.pinpoint;
export const isMac = api.platform === 'darwin';
export const MOD = isMac ? '⌘' : 'Ctrl';
document.documentElement.classList.add(`platform-${api.platform}`);
api.onFullscreen((fs) => document.documentElement.classList.toggle('fullscreen', fs));
export const THREADS_W = 248;
export const SPEND_KEY = 'pp.spend';
export const today = () => new Date().toISOString().slice(0, 10);
export const spentToday = () => { try { const s = JSON.parse(localStorage.getItem(SPEND_KEY) || '{}'); return s.day === today() ? s.total || 0 : 0; } catch { return 0; } };
export const addSpend = (cost: number) => { try { localStorage.setItem(SPEND_KEY, JSON.stringify({ day: today(), total: spentToday() + cost })); } catch { /* storage off */ } };
export const HISTORY_KEY = 'pp.promptHistory';
export const readHistory = (): string[] => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } };
export const rememberPrompt = (text: string) => {
  const t = text.trim();
  if (!t || t.startsWith('/')) return;
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify([t, ...readHistory().filter((x) => x !== t)].slice(0, 200))); } catch { /* storage off */ }
};
export const snippetName = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 3).join('-') || 'snippet';
export const combo = (k: string, shift = false) => isMac ? `⌘${shift ? '⇧' : ''}${k}` : `Ctrl+${shift ? 'Shift+' : ''}${k}`;
export const MATCH_ROUNDS = 3;
export const MATCH_GOAL = 3;
export const QUICK_SIZES = [
  { icon: Monitor, label: 'Fill the window', w: 0, h: 0 },
  { icon: Tablet, label: 'Tablet 820 × 1180 (responsive mode)', w: 820, h: 1180 },
  { icon: Smartphone, label: 'Phone 390 × 844 (responsive mode)', w: 390, h: 844 },
];
export function markerList(anns: Annotation[], activeId: string | null) {
  return anns
    .filter((a) => a.kind === 'element' && a.element?.uid)
    .map((a) => ({ uid: a.element!.uid, selector: a.element!.selector, n: a.n, color: a.color, active: a.id === activeId }));
}
