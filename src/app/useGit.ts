import { api } from './shared';
import type { ChatItem, GitPull, GitStatus } from '../types';
import { makeTab } from '../lib/urls';
import { errText } from '../lib/util';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useGit(app: AppContext) {
  const settings = app.settings;
  // The branch each chat worked on, and the pull requests by branch.
  const branchOf = useRef(new Map<string, string>());
  const [pulls, setPulls] = useState<Record<string, GitPull>>({});
  const [branchCompare, setBranchCompare] = useState<{ base?: string; remote?: boolean; pr?: boolean } | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const wantChat = useRef<string | null>(null);
  // The branch shows as soon as git answers; whether GitHub is signed in follows when the network does.
  const refreshGit = useCallback(async () => {
    api.gitStatus({ fast: true }).then((s) => setGitStatus((now) => (now?.gh && !now.gh.checking ? { ...s, gh: now.gh } : s))).catch(() => {});
    await api.gitStatus().then(setGitStatus).catch(() => setGitStatus(null));
  }, []);
  const commitRun = async (id: string) => {
    try {
      const c = await api.gitCommitRun(id);
      app.setChat((cs) => cs.map((it) => (it.kind === 'done' && it.runId === id ? { ...it, commit: c } : it)));
      app.flash(`Committed ${c.hash}`);
      refreshGit();
    } catch (e) { app.flash(errText(e)); }
  };
  const prDefaults = () => {
    const users = app.chat.filter((c) => c.kind === 'user') as Extract<ChatItem, { kind: 'user' }>[];
    const first = users[0];
    const title = (first?.text || first?.annotations.map((a) => a.note).find(Boolean) || 'Visual edits').split('\n')[0].slice(0, 72);
    const lines = ['## What changed', ''];
    const shots: { runId: string; label: string }[] = [];
    let asked = '';
    for (const it of app.chat) {
      if (it.kind === 'user') asked = (it.text || it.annotations.map((a) => a.note).find(Boolean) || '').split('\n')[0].slice(0, 80);
      if (it.kind === 'done' && it.shots && !it.undone && !it.variant && it.visual !== 'none') shots.push({ runId: it.runId, label: asked });
      if (it.kind === 'user') {
        const asks = [it.text, ...it.annotations.map((a) => a.note)].filter((t) => t && t.trim());
        if (asks.length) lines.push(`- **Asked:** ${asks.map((t) => t.trim().split('\n')[0]).join('; ')}`);
      } else if (it.kind === 'done' && it.changes.length && !it.undone) {
        const files = it.changes.filter((c) => !c.reverted).map((c) => `\`${c.path}\``).join(', ');
        if (files) lines.push(`  - Changed ${files}${it.commit ? ` (${it.commit.hash})` : ''}`);
      }
    }
    lines.push('', '---', 'Made with [Pinpoint](https://github.com/m-ahmed-elbeskeri/pinpoint).');
    return { title, body: lines.join('\n'), shots };
  };
  const openFile = (path: string, line?: number) => {
    api.openFile(path, line)
      .then((r) => app.flash(r.via === 'folder' ? `No editor found, so ${path} is shown in its folder` : `Opened ${path}${r.via !== 'system' ? ` in ${r.via}` : ''}`))
      .catch((e) => app.flash(errText(e)));
  };
  const pickProject = async (known?: string) => {
    const prev = settings?.projectDir;
    if (known && known === prev) return;
    if (known && !app.leaveChat()) return;
    const dir = await api.pickFolder(known);
    if (!dir) return;
    app.setSettings(await api.getSettings()); app.setSession(null); app.flash(`Project: ${dir}`);
    if (dir !== prev) {
      const blank = makeTab('');
      app.handles.current = {};
      app.setTabs([blank]);
      app.setActiveTab(blank.id);
      app.setAnnotations([]);
      app.setUrlInput('');
      app.setDevLog('');
    }
  };
  // Another worktree of the same repository: keeps the dev command and tabs, the dev server restarts there.
  const openWorktree = async (dir: string) => {
    if (dir === settings?.projectDir) return false;
    if (!app.leaveChat()) return false;
    const r = await api.gitOpenWorktree(dir);
    app.setSettings(await api.getSettings()); app.setSession(null);
    app.setAnnotations([]);
    app.setDevLog('');
    refreshGit();
    app.flash(`Worktree: ${r.branch || r.dir}${r.restarted ? ' · dev server restarting there' : ''}`);
    return true;
  };
  useEffect(() => {
    if (!app.projectDir) { setPulls({}); return; }
    const get = () => api.gitPulls().then(setPulls).catch(() => {});
    get();
    const t = setInterval(get, 60000);
    window.addEventListener('focus', get);
    return () => { clearInterval(t); window.removeEventListener('focus', get); };
  }, [app.projectDir, gitStatus?.branch]);

  Object.assign(app, { branchCompare, branchOf, commitRun, gitStatus, openFile, openWorktree, pickProject, prDefaults, pulls, refreshGit, setBranchCompare, wantChat });
}
