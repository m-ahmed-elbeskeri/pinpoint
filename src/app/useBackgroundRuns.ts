import { api } from './shared';
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
        : { ...r, status: e.ok && e.files?.length ? 'done' : e.ok ? 'done' : 'failed', files: e.files, summary: e.summary || (e.ok ? 'Finished without changing any files.' : 'The run did not finish.'), shot: e.shot, step: undefined })));
  }), []);
  useEffect(() => { if (app.projectDir) api.bgBlocker().then(setBgBlocked).catch(() => setBgBlocked('unavailable')); }, [app.projectDir, app.gitStatus?.repo, app.gitStatus?.hasCommits]);
  const applyBg = async (r: BgRun) => {
    const runId = uid();
    try {
      const { changes } = await api.bgApply({ id: r.id, runId, instruction: r.title });
      setBgRuns((list) => list.filter((x) => x.id !== r.id));
      if (!app.chatId) { app.setChatId(uid()); app.setChatCreated(Date.now()); }
      app.setChat((c) => [...c,
        ...(r.summary ? [{ kind: 'text' as const, id: uid(), text: r.summary }] : []),
        { kind: 'done', id: uid(), runId, ok: true, changes, background: true },
      ]);
      if (/^file:/.test(app.nav.url)) app.browser.current?.reload();
      app.refreshGit();
    } catch (e) { app.flash(errText(e)); }
  };
  const discardBg = (r: BgRun) => { api.bgDiscard(r.id).catch(() => {}); setBgRuns((list) => list.filter((x) => x.id !== r.id)); };

  Object.assign(app, { applyBg, bgBlocked, bgRuns, discardBg, setBgRuns });
}
