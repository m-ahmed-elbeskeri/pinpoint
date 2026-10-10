import { shortPath } from '../components/Chat';
import type { Annotation, Handoff } from './types';

const pathOnly = (url: string) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };

export const describe = (a: Annotation, root: string) => {
  if (a.kind === 'element' && a.element) {
    const el = a.element;
    const cls = el.classes?.filter((c) => c.length < 24).slice(0, 2).join('.') || '';
    const extras = [a.reorder ? `moved to ${a.reorder.to + 1}` : '', ...(a.states || []).map((s) => (s === 'disabled' ? s : ':' + s)), a.tweaks ? `${Object.keys(a.tweaks).length} tweak${Object.keys(a.tweaks).length > 1 ? 's' : ''}` : ''].filter(Boolean);
    return {
      title: `<${el.tag}${el.id ? '#' + el.id : ''}${cls ? '.' + cls : ''}>`,
      sub: (el.source?.file ? shortPath(el.source.file, root) + (el.source.line ? `:${el.source.line}` : '')
        : el.source?.components?.length ? el.source.components.slice(-2).join(' › ') : el.text || el.selector) + (extras.length ? ` · ${extras.join(' · ')}` : ''),
    };
  }
  if (a.kind === 'drawing') return { title: 'Drawing on page', sub: a.hits?.length ? `over ${a.hits.length} element${a.hits.length > 1 ? 's' : ''}` : 'markup' };
  if (a.kind === 'reference') return { title: 'Reference image', sub: a.name || 'image' };
  if (a.kind === 'request' && a.request) return { title: `${a.request.method} ${pathOnly(a.request.url)}`, sub: `${a.request.error && !a.request.status ? 'no response' : a.request.status}${a.request.handler ? ` · ${shortPath(a.request.handler.file, root)}:${a.request.handler.line}` : ''}` };
  if (a.kind === 'note') return { title: 'Comment on the page', sub: a.pageUrl ? pathOnly(a.pageUrl) : 'whole page' };
  if (a.kind === 'flow') return { title: 'Recorded interaction', sub: `${a.steps?.length || 0} step${a.steps?.length === 1 ? '' : 's'}` };
  return { title: 'Sketch', sub: 'wireframe' };
};

export function toPlaywright(a: Annotation) {
  const q = (s: string) => JSON.stringify(s);
  const lines = ["import { test } from '@playwright/test';", '', `test(${q(a.note.trim() || 'recorded interaction')}, async ({ page }) => {`];
  if (a.startUrl) lines.push(`  await page.goto(${q(a.startUrl)});`);
  for (const s of a.steps || []) {
    const loc = `page.locator(${q(s.selector || '')})`;
    if (s.type === 'click') lines.push(`  await ${loc}.click();${s.text ? ` // ${s.text}` : ''}`);
    else if (s.type === 'fill') lines.push(`  await ${loc}.fill(${s.secret ? "process.env.TEST_PASSWORD ?? ''" : q(s.value || '')});`);
    else if (s.type === 'check') lines.push(`  await ${loc}.setChecked(${s.value === 'true'});`);
    else if (s.type === 'key') lines.push(`  await page.keyboard.press(${q(s.key || '')});`);
    else if (s.type === 'navigate') lines.push(`  await page.waitForURL(${q(s.url || '')});`);
  }
  lines.push('  // TODO: assert what should be true here', '});', '');
  return lines.join('\n');
}

export function handoffMarkdown(h: Handoff, root: string) {
  const out = ['## Request', '', h.instruction || '_(see the notes below)_', '', `- Page: ${h.url}${h.viewport ? ` (${h.viewport.width}×${h.viewport.height})` : ''}`, ''];
  for (const a of h.annotations) {
    const d = describe(a, root);
    out.push(`### ${a.n}. ${d.title}${a.note.trim() ? `: ${a.note.trim()}` : ''}`);
    const el = a.element;
    if (el) {
      out.push(`- Selector: \`${el.selector}\``);
      if (el.source?.file) out.push(`- Source: \`${shortPath(el.source.file, root)}${el.source.line ? `:${el.source.line}` : ''}\``);
      if (el.component?.name) out.push(`- Component: \`<${el.component.name}>\`${a.scope ? ` (${a.scope === 'instance' ? 'this instance only' : 'all uses'})` : ''}`);
      if (a.states?.length) out.push(`- State: ${a.states.join(', ')}`);
      for (const [k, v] of Object.entries(a.tweaks || {})) out.push(`- \`${k}\`: ${el.styles?.[k] ? `${el.styles[k]} → ` : ''}${v}`);
      if (a.textEdit) out.push(`- Text: "${a.textEdit.from}" → "${a.textEdit.to}"`);
      if (a.classEdit) out.push(`- Classes: \`${a.classEdit.from}\` → \`${a.classEdit.to}\``);
    }
    (a.steps || []).forEach((s, i) => out.push(`${i + 1}. ${s.type}${s.selector ? ` \`${s.selector}\`` : ''}${s.text ? ` "${s.text}"` : ''}${s.value && !s.secret ? ` = ${s.value}` : ''}${s.key || s.url ? ` ${s.key || s.url}` : ''}`));
    if (a.image) out.push('- _Screenshot in the hand-off file_');
    out.push('');
  }
  out.push('---', 'Made with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint). Open the hand-off file in Pinpoint (share menu → Open hand-off file) to run this request with its screenshots.');
  return out.join('\n');
}
