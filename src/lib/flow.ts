import type { FlowResult } from './types';

export function flowVerdict(f: FlowResult) {
  const stopped = f.done < f.total;
  const problems = f.errors.length + f.failed.length;
  const had = (f.before?.errors || 0) + (f.before?.failed || 0);
  const steps = `${f.total} step${f.total === 1 ? '' : 's'}`;
  if (stopped) return { ok: false, text: `Replayed your steps: stopped at step ${f.done + 1} of ${f.total}, where the page no longer had what you clicked` };
  if (problems) return { ok: false, text: `Replayed your ${steps}: ${problems} error${problems === 1 ? '' : 's'} came up${had ? ` (${had} when you recorded it)` : ''}` };
  return { ok: true, text: `Replayed your ${steps}: all ran, no errors${had ? ` (${had} when you recorded it)` : ''}` };
}
