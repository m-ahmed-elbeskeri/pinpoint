import { api } from './shared';
import { uid } from '../lib/draw';
import { handoffMarkdown } from '../lib/handoff';
import type { Handoff } from '../types';
import { errText } from '../lib/util';
import type { AppContext } from './context';

export function useHandoff(app: AppContext) {
  const buildHandoff = (): Handoff => ({
    pinpointHandoff: 1, createdAt: Date.now(), url: app.nav.url, title: app.nav.title,
    viewport: app.browser.current?.size(), instruction: app.instruction.trim(), annotations: app.annotations,
  });
  const exportHandoff = async () => {
    const h = buildHandoff();
    const name = (h.instruction || h.annotations.map((a) => a.note).find(Boolean) || 'request').split('\n')[0].replace(/[^\w -]+/g, '').trim().slice(0, 40) || 'request';
    try {
      const file = await api.saveHandoff(name, h);
      if (file) app.flash(`Saved ${file.split(/[\\/]/).pop()}. Send it to whoever will run it.`);
    } catch (e) { app.flash(errText(e)); }
  };
  const copyHandoff = () => { navigator.clipboard?.writeText(handoffMarkdown(buildHandoff(), app.root)); app.flash('Request copied as Markdown.'); };
  const issueHandoff = async () => {
    const h = buildHandoff();
    const title = (h.instruction || h.annotations.map((a) => a.note).find(Boolean) || 'Visual change request').split('\n')[0].slice(0, 80);
    const attach = h.annotations.some((a) => a.image) ? { name: title, data: h } : undefined;
    try {
      const r = await api.handoffIssue({ title, body: handoffMarkdown(h, app.root), attach });
      app.flash(attach && !r.gist ? "Issue created, but the screenshots couldn't be uploaded. Send the hand-off file separately." : 'Issue created and opened in your browser.');
    } catch (e) { app.flash(errText(e)); }
  };
  const importHandoff = async () => {
    try {
      const h = await api.openHandoff();
      if (!h) return;
      let n = app.nextN();
      const added = h.annotations.map((a) => ({ ...a, id: uid(), n: n++, color: app.colorFor(n - 1) }));
      app.setAnnotations((prev) => [...prev, ...added]);
      if (h.instruction) app.setInstruction((t) => (t.trim() ? `${t}\n\n${h.instruction}` : h.instruction));
      app.flash(`Loaded ${added.length} annotation${added.length === 1 ? '' : 's'} made on ${h.url}. Review, then send.`);
    } catch (e) { app.flash(errText(e)); }
  };

  Object.assign(app, { copyHandoff, exportHandoff, importHandoff, issueHandoff });
}
