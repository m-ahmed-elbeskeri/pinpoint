import { api } from './shared';
import { applyEvent } from '../components/agent/Transcript';
import { uid } from '../lib/draw';
import type { BgRun } from '../types';
import { errText } from '../lib/util';
import { useEffect, useState } from 'react';
import type { AppContext } from './context';

export function useBackgroundRuns(app: AppContext) {
  const [bgRuns, setBgRuns] = useState<BgRun[]>([]);
  const [bgBlocked, setBgBlocked] = useState<string | null>(null);
  useEffect(() => api.onBgEvent((e) => {
    setBgRuns((list) => list.map((r) => (r.id !== e.id ? r
      : e.type === 'step' ? { ...r, step: e.text }
        : e.type === 'agent' ? (e.event ? { ...r, items: applyEvent(r.items, e.event) } : r)
        : { ...r, items: applyEvent(r.items, { type: 'done' }), status: e.ok && e.files?.length ? 'done' : e.ok ? 'done' : 'failed', files: e.files, summary: e.summary || (e.ok ? 'Finished without changing any files.' : 'The run did not finish.'), shot: e.shot, step: undefined })));
  }), []);
  useEffect(() => { if (app.projectDir) api.bgBlocker().then(setBgBlocked).catch(() => setBgBlocked('unavailable')); }, [app.projectDir, app.gitStatus?.repo, app.gitStatus?.hasCommits]);
  const applyBg = async (r: BgRun) => {
    const runId = uid();
    try {
      const { changes } = await api.bgApply({ id: r.id, runId, instruction: r.title });
      setBgRuns((list) => list.filter((x) => x.id !== r.id));
      closeBgView(r.id);
      if (!app.chatId) { app.setChatId(uid()); app.setChatCreated(Date.now()); }
      app.setChat((c) => [...c,
        ...(r.summary ? [{ kind: 'text' as const, id: uid(), text: r.summary }] : []),
        { kind: 'done', id: uid(), runId, ok: true, changes, background: true },
      ]);
      if (/^file:/.test(app.nav.url)) app.browser.current?.reload();
      app.refreshGit();
    } catch (e) { app.flash(errText(e)); }
  };
  const closeBgView = (id: string) => { if (app.activeSide === `bg:${id}`) app.setActiveSide(null); };
  const discardBg = (r: BgRun) => { api.bgDiscard(r.id).catch(() => {}); setBgRuns((list) => list.filter((x) => x.id !== r.id)); closeBgView(r.id); };
  // Replying to a task continues its agent in the task's own copy of the project.
  const askBg = (r: BgRun, text: string) => {
    const context = r.items.flatMap((it) => (it.kind === 'user' ? [`User: ${it.text}`] : it.kind === 'agent' && it.text ? [`Agent: ${it.text}`] : [])).join('\n').slice(-6000);
    setBgRuns((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'running', step: undefined, items: [...x.items, { kind: 'user', id: uid(), text }] } : x)));
    api.bgAsk({ id: r.id, text, context }).catch((e) => {
      app.flash(errText(e));
      setBgRuns((list) => list.map((x) => (x.id === r.id ? { ...x, status: 'failed' } : x)));
    });
  };
  const openBg = (id: string) => {
    app.setActiveSide(`bg:${id}`);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
  };

  Object.assign(app, { applyBg, askBg, bgBlocked, bgRuns, discardBg, openBg, setBgRuns });
}
