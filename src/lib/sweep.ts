import type { SweepIssue, SweepPage } from './types';

export interface GroupedIssue { issue: SweepIssue; sizes: string[]; everywhere: boolean }

const ORDER = ['phone', 'tablet', 'desktop'];
const LABEL: Record<string, string> = { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' };

export function groupIssues(page: SweepPage): GroupedIssue[] {
  const groups = new Map<string, GroupedIssue>();
  const shots = [...page.shots].sort((a, b) => ORDER.indexOf(a.size) - ORDER.indexOf(b.size));
  for (const shot of shots) {
    for (const issue of shot.issues) {
      const key = `${issue.type}:${issue.text}`;
      const g = groups.get(key) || { issue, sizes: [], everywhere: false };
      g.sizes.push(LABEL[shot.size] || shot.size);
      groups.set(key, g);
    }
  }
  return [...groups.values()].map((g) => ({ ...g, everywhere: g.issue.type === 'a11y' || g.sizes.length >= ORDER.length }));
}

export const problemCount = (pages: SweepPage[]) => pages.reduce((n, p) => n + groupIssues(p).length, 0);

export function worstShots(pages: SweepPage[], max = 4) {
  return pages
    .flatMap((p) => p.shots.map((s) => ({ page: p, shot: s, weight: s.issues.filter((i) => i.type === 'overflow' || i.type === 'text' || i.type === 'image' || i.type === 'tap').length })))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}

export function sweepInstruction(pages: SweepPage[], fileOf: (page: SweepPage) => string | undefined = () => undefined) {
  const out = ['Fix these problems, found by loading each page at phone (390px), tablet (820px) and desktop (1280px) widths:', ''];
  for (const p of pages) {
    const groups = groupIssues(p);
    if (!groups.length) continue;
    const file = fileOf(p);
    out.push(`${p.route}${file ? ` (${file})` : ''}`);
    for (const g of groups.slice(0, 10)) {
      out.push(`- ${g.everywhere ? '' : `${g.sizes.join(' and ')}: `}${g.issue.text}${g.issue.nodes?.length ? `. Look at: ${g.issue.nodes.join('; ')}` : ''}`);
    }
    out.push('');
  }
  out.push('Fix each one at the width where it happens and leave the other widths looking as they do. Then tell me what caused each.');
  return out.join('\n');
}
