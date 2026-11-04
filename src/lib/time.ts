// How long ago, in the three wordings the app uses. They really differ, so each keeps its own name.

// Building a formatter is the slow part of toLocale*String, and long lists format a date per row, so each is made once.
const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dateOnly = new Intl.DateTimeFormat();
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// "Jan 5, 2026, 3:04 PM": the exact moment, for tooltips.
export const fullDate = (t: number) => dateTime.format(t);

// Each takes `now` so a compiled component can pass the clock in (see useNow); React Compiler caches calls by their arguments.

// "now", "5m", "2h", "3d", "2w", then "Jan 5": lists where every row has one.
export function agoShort(t: number, now = Date.now()) {
  const s = (now - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 35) return `${Math.floor(s / 86400 / 7)}w`;
  return monthDay.format(t);
}

// "just now", "5m ago", "2h ago", "3d ago", then the full date.
export function agoLong(t: number, now = Date.now()) {
  const s = (now - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return dateOnly.format(t);
}

// "just now", "5 min ago", "2 h ago", with no cut-off.
export function agoMinutes(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// A duration: "12s", "3m 5s".
export const secs = (ms?: number) => (!ms ? '' : ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
