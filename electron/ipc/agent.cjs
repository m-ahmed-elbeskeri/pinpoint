const { app, ipcMain } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { runAgent, detectAgents, modelCatalog, harnessList } = require('../agents/index.cjs');
const { sleep, readJson, inspectSafe } = require('../fsutil.cjs');
const gitx = require('../git/index.cjs');
const { agentName: harnessName } = require('../agents/harnesses.cjs');
const project = require('../project/store.cjs');
const { buildPrompt, buildSteerPrompt, buildVerifyPrompt } = require('../prompt/index.cjs');
const routecheck = require('../page/routecheck.cjs');
const runs = require('../project/runs.cjs');
const snapshot = require('../project/snapshot.cjs');

const BEFORE_SHOTS_TIMEOUT_MS = 10000;
const PR_DRAFT_TIMEOUT_MS = 180000;

const othersWrote = new Map();
const fileSig = (root, rel) => {
  try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(root, rel))).digest('hex'); } catch { return 'gone'; }
};

const approvals = new Map();

function readOnly(settings) {
  const id = settings.agent;
  const h = harnessList(settings).find((x) => x.id === id);
  const first = h?.access?.[0]?.value;
  return { ...settings, claudePermission: 'plan', codexSandbox: 'read-only', agentAccess: { ...settings.agentAccess, ...(first ? { [id]: first } : {}) }, gitAutoCommit: false };
}

function register(ctx) {
  const { active, sideRuns, loadSettings, projectDir } = ctx;
  const agentsFile = () => path.join(app.getPath('userData'), 'agents.json');
  ipcMain.handle('agents:known', () => readJson(agentsFile()));
  ipcMain.handle('agents:detect', async () => {
    const found = await detectAgents(loadSettings());
    fs.promises.writeFile(agentsFile(), JSON.stringify(found)).catch(() => { /* only a cache: detected again next time */ });
    return found;
  });
  ipcMain.handle('agents:models', () => modelCatalog());
  ipcMain.handle('agents:list', () => harnessList(loadSettings()));

  ipcMain.handle('agent:run', async (e, { runId, request, sessionId, check }) => {
    const settings = loadSettings();
    const cwd = settings.projectDir;
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a project folder first.');

    const files = project.writeRequestFiles(cwd, runId, request);
    const design = settings.useDesign ? project.readDesign(cwd) : null;
    const memory = settings.useMemory ? project.readMemory(cwd).filter((m) => m.enabled !== false && m.text?.trim()) : [];
    const designSystem = sessionId ? null : inspectSafe(cwd);
    const prompt = request.verify
      ? buildVerifyPrompt({ request })
      : buildPrompt({ request, files, projectDir: cwd, followUp: !!sessionId, design: design?.exists ? design.content : '', memory, designSystem });
    const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('agent:event', { runId, ...evt }); };

    if (active.size && !request.verify) send({ type: 'status', text: 'Another chat is also editing this project. Changes made at the same time can show up in both results.' });
    if (settings.gitBranchPerChat && !sessionId && !(request.variant?.index > 1) && !active.size) {
      try {
        const st = await gitx.status(cwd);
        if (st.repo && st.hasCommits) {
          const hint = request.instruction || request.annotations.map((a) => a.note).find(Boolean) || '';
          const branch = await gitx.createBranch(cwd, hint);
          send({ type: 'status', text: `On new branch ${branch}` });
          send({ type: 'git', branch });
        }
      } catch (err) { send({ type: 'log', text: `git branch failed: ${err.message}` }); }
    }

    const agentName = harnessName(settings);
    const snap = await snapshot.takeAsync(cwd);
    othersWrote.set(runId, new Map());
    let routes = null;
    if (check && !request.variant && !request.verify) {
      const list = settings.routeCheck !== false ? check.routes || [] : [];
      try { routes = routecheck.begin(cwd, list, settings.perfCheck !== false ? check.perfUrl : null, check.targets || [], check.partition || undefined); } catch (err) { send({ type: 'log', text: `route check skipped: ${err.message}` }); }
      routes?.before.catch(() => { /* picked up by finish() */ });
      routes?.perfBefore.catch(() => { /* picked up by finishPerf() */ });
    }
    if (routes) {
      const ready = Promise.all([routes.before, routes.perfBefore]).then(() => true, () => true);
      const slow = setTimeout(() => send({ type: 'status', text: 'Taking "before" screenshots of your pages…' }), 900);
      const inTime = await Promise.race([ready, sleep(BEFORE_SHOTS_TIMEOUT_MS).then(() => false)]);
      clearTimeout(slow);
      if (!inTime) { send({ type: 'log', text: 'before-screenshots took too long; skipping the visual change check for this run' }); routes = null; }
    }
    const onEvent = async (evt) => {
      if (evt.type !== 'done') return send(evt);
      let changes = await snapshot.diffAsync(snap);
      const theirs = othersWrote.get(runId);
      othersWrote.delete(runId);
      if (theirs?.size) changes = changes.filter((c) => theirs.get(c.path) !== fileSig(cwd, c.path));
      for (const seen of othersWrote.values()) for (const c of changes) seen.set(c.path, fileSig(cwd, c.path));
      try { changes = runs.save(cwd, runId, snap, changes, { request: { instruction: request.instruction, annotations: request.annotations.map(({ n, kind, note, element }) => ({ n, kind, note, element: element && { tag: element.tag, source: element.source } })) }, agent: agentName, url: request.url }); } catch (err) { send({ type: 'log', text: `could not save run record: ${err.message}` }); }
      let commit = null;
      if (settings.gitAutoCommit && changes.length && evt.ok && !request.variant) {
        try {
          const st = await gitx.status(cwd);
          if (st.repo) {
            commit = await gitx.commitPaths(cwd, changes.map((c) => c.path), gitx.commitMessage(request, changes, agentName));
            if (commit) runs.setMeta(cwd, runId, { commit });
          }
        } catch (err) { send({ type: 'log', text: `git commit failed: ${err.message}` }); }
      }
      send({ ...evt, changes, commit, request: { instruction: request.instruction, notes: request.annotations.map((a) => a.note).filter(Boolean) } });
      if (routes && evt.ok && changes.length) {
        const shared = changes.some((c) => c.path !== check.currentFile);
        routecheck.finish(routes, (name, buf) => runs.saveShotBuffer(cwd, runId, name, buf), shared)
          .catch((err) => { send({ type: 'log', text: `route check failed: ${err.message}` }); return []; })
          .then(async (results) => {
            const perf = await routecheck.finishPerf(routes).catch(() => null);
            if (results.length || perf) send({ type: 'routes', results, perf });
          });
      }
    };
    // Permission questions from the agent become a card in the chat; the run waits for the answer.
    let approvalSeq = 0;
    const askApproval = ({ tool, detail }) => new Promise((resolve) => {
      const approvalId = `a${++approvalSeq}`;
      approvals.set(`${runId}:${approvalId}`, resolve);
      send({ type: 'approval', approvalId, tool, detail: String(detail || '').slice(0, 600) });
    });
    const handle = runAgent({ settings, cwd, prompt, images: files.images, sessionId, requestDir: files.dir, onEvent, askApproval });
    active.set(runId, handle);
    handle.done.finally(() => {
      active.delete(runId); othersWrote.delete(runId);
      for (const [key, resolve] of approvals) if (key.startsWith(`${runId}:`)) { approvals.delete(key); resolve('deny'); }
    });
    return { requestDir: files.dir };
  });

  ipcMain.handle('run:diff', (_e, runId) => runs.diff(projectDir(), runId));
  ipcMain.handle('run:revert', (_e, { runId, paths, force }) => runs.revert(projectDir(), runId, paths || null, !!force));
  ipcMain.handle('run:revertHunk', (_e, { runId, path: file, index }) => runs.revertHunk(projectDir(), runId, file, index));
  ipcMain.handle('run:apply', (_e, runId) => runs.apply(projectDir(), runId));

  ipcMain.handle('routes:prewarm', (_e, { list, partition }) => {
    const settings = loadSettings();
    if (settings.routeCheck === false || !settings.projectDir || active.size || !list?.length) return false;
    routecheck.prewarm(settings.projectDir, list, partition || undefined).catch(() => { /* best effort */ });
    return true;
  });

  ipcMain.handle('agent:steer', (_e, { runId, steerId, request, mode }) => {
    const handle = active.get(runId);
    if (!handle || !handle.steerable) return { delivered: false };
    const cwd = loadSettings().projectDir;
    const files = project.writeRequestFiles(cwd, `${runId}-${steerId}`, request);
    const text = buildSteerPrompt({ request, files, mode });
    const delivered = mode === 'now' ? handle.interrupt(text, files.images) : handle.steer(text, files.images);
    return { delivered };
  });

  ipcMain.handle('agent:nudge', (_e, runId) => {
    const handle = active.get(runId);
    if (!handle || !handle.steerable) return false;
    return !!handle.interrupt('Stop the step you were on. Act now on the message I sent you a moment ago, the one that was waiting behind that step.', []);
  });

  // Side chat: a quick question to the same agent, read-only, in its own session. It never snapshots,
  // records a run or touches the main chat.

  ipcMain.handle('side:ask', (e, { sideId, question, context, sessionId }) => {
    const settings = loadSettings();
    const cwd = settings.projectDir;
    if (!cwd || !fs.existsSync(cwd)) throw new Error('Pick a project folder first.');
    project.ensureDir(cwd);
    const requestDir = path.join(cwd, '.pinpoint', 'side', `${sideId}-${Date.now().toString(36)}`);
    fs.mkdirSync(requestDir, { recursive: true });
    const prompt = [
      'This is a quick side question about this project, asked next to the main conversation.',
      'Do not edit, create or delete any files and do not run commands that change anything. Look at whatever you need, then answer briefly and plainly.',
      !sessionId && context ? `\nWhat the main conversation has been about (for reference only):\n<main-chat>\n${context}\n</main-chat>` : '',
      `\nQuestion: ${question}`,
    ].join('\n');
    const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('side:event', { sideId, ...evt }); };
    sideRuns.get(sideId)?.kill();
    const handle = runAgent({ settings: readOnly(settings), cwd, prompt, images: [], sessionId: sessionId || null, requestDir, onEvent: send });
    sideRuns.set(sideId, handle);
    handle.done.finally(() => { if (sideRuns.get(sideId) === handle) sideRuns.delete(sideId); });
    return true;
  });
  ipcMain.handle('side:cancel', (_e, sideId) => { sideRuns.get(sideId)?.kill(); return true; });

  // The agent writes the pull request's description from the chat and the branch's diff, without touching anything.
  ipcMain.handle('git:prDraft', async (_e, { draft, base }) => {
    const settings = loadSettings();
    const cwd = settings.projectDir;
    project.ensureDir(cwd);
    const requestDir = path.join(cwd, '.pinpoint', 'side', `pr-${Date.now().toString(36)}`);
    fs.mkdirSync(requestDir, { recursive: true });
    const prompt = [
      'Write the description for a pull request of the current git branch.',
      `Look at the commits and diff against ${base || 'the default branch'} (for example with git log and git diff). Do not edit, create or delete anything.`,
      'Say what changed and why in plain language, then anything a reviewer should check. Use short Markdown sections. Do not invent testing that did not happen.',
      'Reply with only the description, no preamble.',
      `\nThe notes below were put together from the chat that made these changes:\n<notes>\n${String(draft || '').slice(0, 6000)}\n</notes>`,
    ].join('\n');
    let text = '', failed = '';
    const handle = runAgent({ settings: readOnly(settings), cwd, prompt, images: [], sessionId: null, requestDir, onEvent: (ev) => {
      if (ev.type === 'text_delta') text += ev.text;
      else if (ev.type === 'error') failed = ev.text || 'The agent could not write it.';
    } });
    const stop = setTimeout(() => handle.kill(), PR_DRAFT_TIMEOUT_MS);
    try { await handle.done; } finally { clearTimeout(stop); }
    if (!text.trim()) throw new Error(failed || 'The agent returned nothing.');
    return text.trim();
  });

  ipcMain.handle('agent:approve', (_e, { runId, approvalId, decision }) => {
    const resolve = approvals.get(`${runId}:${approvalId}`);
    if (!resolve) return false;
    approvals.delete(`${runId}:${approvalId}`);
    resolve(['allow', 'always', 'deny'].includes(decision) ? decision : 'deny');
    return true;
  });

  ipcMain.handle('agent:cancel', (_e, runId) => {
    active.get(runId)?.kill();
    return true;
  });

  ipcMain.handle('run:saveShot', (_e, { runId, name, dataUrl }) => {
    runs.saveShot(projectDir(), runId, name, dataUrl);
    return true;
  });
  ipcMain.handle('run:shots', (_e, runId, names) => runs.shots(projectDir(), runId, Array.isArray(names) ? names : undefined));
}

module.exports = { register };
