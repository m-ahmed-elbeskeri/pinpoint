// Codex as a live session over `codex app-server` (JSON-RPC on stdio), which
// supports steering a running turn (turn/steer) and interrupting it
// (turn/interrupt). Falls back to one-shot `codex exec` if the app server
// can't be started (older Codex versions).
const { spawnCli, lineReader, killProc } = require('./cli.cjs');

const INIT_TIMEOUT_MS = 60000;

function toInput(text, images = []) {
  return [
    { type: 'text', text, text_elements: [] },
    ...images.map((p) => ({ type: 'localImage', path: p })),
  ];
}

function runCodex(opts) {
  const { settings, cwd, prompt, images, sessionId, onEvent } = opts;
  const extra = settings.codexModel ? ['-c', `model="${settings.codexModel}"`] : [];
  const proc = spawnCli(settings.codexPath || 'codex', ['app-server', ...extra], cwd);

  let finished = false;
  let initialized = false;
  let fellBack = false;
  let fallbackHandle = null;
  let threadId = null;
  let activeTurn = null;       // id of the in-progress turn
  let nextInput = null;        // input to start once an interrupted turn completes
  let cancelling = false;
  let startedAt = Date.now();
  let seq = 0;
  const pending = new Map();

  const send = (obj) => { if (proc.stdin.writable) proc.stdin.write(JSON.stringify(obj) + '\n'); };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });

  const finish = (ok) => {
    if (finished) return;
    finished = true;
    onEvent({ type: 'done', ok, durationMs: Date.now() - startedAt, sessionId: threadId });
    setTimeout(() => killProc(proc), 200);
  };

  const fallback = (why) => {
    if (fellBack || finished) return;
    fellBack = true;
    onEvent({ type: 'log', text: `codex app-server unavailable (${why}); using codex exec without live steering` });
    killProc(proc);
    fallbackHandle = runCodexExec(opts);
    fallbackHandle.done.then(() => { finished = true; });
  };

  const startTurn = async (input) => {
    const r = await request('turn/start', { threadId, input, ...(settings.codexEffort ? { effort: settings.codexEffort } : {}) });
    activeTurn = r?.turn?.id || activeTurn;
  };

  const onNotification = (method, p) => {
    const item = p?.item;
    switch (method) {
      case 'item/agentMessage/delta':
        if (p?.delta) onEvent({ type: 'text_delta', text: p.delta });
        break;
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        if (p?.delta) onEvent({ type: 'thinking_delta', text: p.delta });
        break;
      case 'turn/started':
        activeTurn = p.turn?.id || activeTurn;
        break;
      case 'item/started':
        if (item?.type === 'commandExecution') onEvent({ type: 'tool', id: item.id, name: 'Shell', detail: item.command });
        else if (item?.type === 'mcpToolCall') onEvent({ type: 'tool', id: item.id, name: `${item.server}.${item.tool}`, detail: '' });
        else if (item?.type === 'webSearch') onEvent({ type: 'tool', id: item.id, name: 'WebSearch', detail: item.query || '' });
        break;
      case 'item/completed':
        if (!item) break;
        if (item.type === 'agentMessage' && item.text?.trim()) onEvent({ type: 'text', text: item.text });
        else if (item.type === 'reasoning') {
          const t = [...(item.summary || []), ...(item.content || [])].join('\n').trim();
          if (t) onEvent({ type: 'thinking', text: t });
        } else if (item.type === 'commandExecution') {
          onEvent({ type: 'tool_result', id: item.id, ok: item.status === 'completed' && (item.exitCode ?? 0) === 0, text: (item.aggregatedOutput || '').slice(-2000) });
        } else if (item.type === 'fileChange') {
          for (const c of item.changes || []) {
            const kind = c.kind?.type;
            onEvent({ type: 'tool', id: `${item.id}:${c.path}`, name: kind === 'add' ? 'Write' : kind === 'delete' ? 'Delete' : 'Edit', detail: c.path });
            onEvent({ type: 'tool_result', id: `${item.id}:${c.path}`, ok: item.status !== 'failed', text: (c.diff || '').slice(0, 2000) });
          }
        } else if (item.type === 'mcpToolCall' || item.type === 'webSearch') {
          onEvent({ type: 'tool_result', id: item.id, ok: item.status !== 'failed', text: '' });
        }
        break;
      case 'turn/completed': {
        const turn = p.turn || {};
        if (turn.id === activeTurn) activeTurn = null;
        if (nextInput && !cancelling) {
          const input = nextInput;
          nextInput = null;
          onEvent({ type: 'status', text: 'Interrupted. Continuing with your new message.' });
          startTurn(input).catch((e) => { onEvent({ type: 'error', text: e.message }); finish(false); });
          break;
        }
        if (turn.status === 'failed') onEvent({ type: 'error', text: turn.error?.message || 'Codex turn failed' });
        finish(turn.status === 'completed');
        break;
      }
      case 'error':
        if (!p?.willRetry) onEvent({ type: 'error', text: p?.error?.message || 'Codex error' });
        else onEvent({ type: 'log', text: `retrying: ${p?.error?.message}` });
        break;
      case 'warning': case 'configWarning': case 'deprecationNotice':
        onEvent({ type: 'log', text: p?.message || p?.summary || method });
        break;
      default:
        break;
    }
  };

  lineReader(proc.stdout, (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return onEvent({ type: 'log', text: line }); }
    if (m.id != null && !m.method) {
      const pnd = pending.get(m.id);
      if (!pnd) return;
      pending.delete(m.id);
      if (m.error) pnd.reject(new Error(m.error.message || JSON.stringify(m.error)));
      else pnd.resolve(m.result);
    } else if (m.id != null && m.method) {
      // Server → client request (approvals, user input). We run with approvals
      // off, so these are rare; accept approvals, decline anything else.
      if (/requestApproval|Approval$/.test(m.method)) send({ id: m.id, result: { decision: settings.codexSandbox === 'read-only' ? 'decline' : 'accept' } });
      else send({ id: m.id, error: { code: -32601, message: `Pinpoint does not handle ${m.method}` } });
    } else if (m.method) {
      onNotification(m.method, m.params);
    }
  });
  lineReader(proc.stderr, (line) => onEvent({ type: 'log', text: line }));
  proc.stdin.on('error', () => {});

  const done = new Promise((resolve) => {
    proc.on('error', (err) => {
      if (!initialized) { fallback(err.message); fallbackHandle?.done.then(resolve); return; }
      onEvent({ type: 'error', text: `Codex failed: ${err.message}` });
      finish(false);
      resolve();
    });
    proc.on('close', (code) => {
      if (fellBack) { fallbackHandle?.done.then(resolve); return; }
      if (!initialized && !finished) { fallback(`exited with code ${code}`); fallbackHandle?.done.then(resolve); return; }
      if (!finished) {
        onEvent({ type: 'error', text: cancelling ? 'Stopped.' : `Codex exited with code ${code}` });
        finish(false);
      }
      resolve();
    });
  });

  // Handshake → thread → first turn.
  (async () => {
    const timer = setTimeout(() => { if (!initialized) fallback('timed out'); }, INIT_TIMEOUT_MS);
    try {
      await request('initialize', { clientInfo: { name: 'pinpoint', title: 'Pinpoint', version: '0.1.0' }, capabilities: null });
      initialized = true;
      clearTimeout(timer);
      send({ method: 'initialized' });
      const common = { cwd, sandbox: settings.codexSandbox || 'workspace-write', approvalPolicy: 'never', ...(settings.codexModel ? { model: settings.codexModel } : {}) };
      const th = sessionId
        ? await request('thread/resume', { threadId: sessionId, ...common })
        : await request('thread/start', common);
      threadId = th?.thread?.id || sessionId;
      onEvent({ type: 'session', sessionId: threadId, model: th?.model });
      startedAt = Date.now();
      await startTurn(toInput(prompt, images));
    } catch (e) {
      if (!initialized) return fallback(e.message);
      onEvent({ type: 'error', text: `Codex: ${e.message}` });
      finish(false);
    }
  })();

  return {
    done,
    get steerable() { return !fellBack; },
    steer(text, imgs) {
      if (fellBack) return fallbackHandle.steer(text, imgs);
      if (finished || !threadId) return false;
      const input = toInput(text, imgs);
      if (!activeTurn) { startTurn(input).catch((e) => onEvent({ type: 'error', text: e.message })); return true; }
      request('turn/steer', { threadId, input, expectedTurnId: activeTurn })
        // The turn may have just ended; start a new one with the message instead.
        .catch(() => startTurn(input).catch((e) => onEvent({ type: 'error', text: e.message })));
      return true;
    },
    interrupt(text, imgs) {
      if (fellBack) return fallbackHandle.interrupt(text, imgs);
      if (finished || !threadId) return false;
      const input = toInput(text, imgs);
      if (!activeTurn) { startTurn(input).catch((e) => onEvent({ type: 'error', text: e.message })); return true; }
      nextInput = input;
      request('turn/interrupt', { threadId, turnId: activeTurn }).catch((e) => onEvent({ type: 'log', text: `interrupt: ${e.message}` }));
      return true;
    },
    kill() {
      if (fellBack) return fallbackHandle.kill();
      if (finished) return;
      cancelling = true;
      nextInput = null;
      if (threadId && activeTurn) request('turn/interrupt', { threadId, turnId: activeTurn }).catch(() => {});
      setTimeout(() => { if (!finished) { onEvent({ type: 'error', text: 'Stopped.' }); finish(false); } }, 3000);
    },
  };
}

// ---------- one-shot fallback: `codex exec --json` (no live steering) ----------
function runCodexExec({ settings, cwd, prompt, images, sessionId, onEvent }) {
  const sandbox = settings.codexSandbox || 'workspace-write';
  const common = ['--json', '--skip-git-repo-check', '-c', `sandbox_mode="${sandbox}"`];
  if (settings.codexModel) common.push('-m', settings.codexModel);
  if (settings.codexEffort) common.push('-c', `model_reasoning_effort="${settings.codexEffort}"`);
  for (const img of images || []) common.push('-i', img);
  const args = sessionId ? ['exec', 'resume', ...common, sessionId, '-'] : ['exec', ...common, '-C', cwd, '-'];

  const proc = spawnCli(settings.codexPath || 'codex', args, cwd);
  let finished = false;
  let cancelled = false;
  const finish = (ok) => { if (!finished) { finished = true; onEvent({ type: 'done', ok }); } };

  lineReader(proc.stdout, (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return onEvent({ type: 'log', text: line }); }
    const item = m.item;
    if (m.type === 'thread.started') onEvent({ type: 'session', sessionId: m.thread_id });
    else if (m.type === 'item.started' && item?.type === 'command_execution') onEvent({ type: 'tool', id: item.id, name: 'Shell', detail: item.command });
    else if (m.type === 'item.completed' && item) {
      if (item.type === 'agent_message' && item.text?.trim()) onEvent({ type: 'text', text: item.text });
      else if (item.type === 'reasoning' && item.text?.trim()) onEvent({ type: 'thinking', text: item.text });
      else if (item.type === 'command_execution') onEvent({ type: 'tool_result', id: item.id, ok: item.exit_code === 0, text: (item.aggregated_output || '').slice(-2000) });
      else if (item.type === 'file_change') for (const c of item.changes || []) onEvent({ type: 'tool', id: `${item.id}:${c.path}`, name: c.kind === 'add' ? 'Write' : c.kind === 'delete' ? 'Delete' : 'Edit', detail: c.path });
      else if (item.type === 'error') onEvent({ type: 'log', text: item.message });
    } else if (m.type === 'turn.completed') finish(true);
    else if (m.type === 'turn.failed') { onEvent({ type: 'error', text: m.error?.message || 'Codex turn failed' }); finish(false); }
    else if (m.type === 'error') onEvent({ type: 'error', text: m.message || 'Codex error' });
  });
  lineReader(proc.stderr, (line) => onEvent({ type: 'log', text: line }));
  proc.stdin.on('error', () => {});

  const done = new Promise((resolve) => {
    proc.on('error', (err) => { onEvent({ type: 'error', text: `Could not start Codex: ${err.message}. Check the CLI path in Settings.` }); finish(false); resolve(); });
    proc.on('close', (code) => {
      if (!finished) {
        if (cancelled) onEvent({ type: 'error', text: 'Stopped.' });
        else if (code !== 0) onEvent({ type: 'error', text: `Codex exited with code ${code}` });
        finish(!cancelled && code === 0);
      }
      resolve();
    });
  });
  proc.stdin.write(prompt);
  proc.stdin.end();

  return {
    done,
    steerable: false,
    steer: () => false,
    interrupt: () => false,
    kill() { cancelled = true; killProc(proc); },
  };
}

module.exports = { runCodex };
