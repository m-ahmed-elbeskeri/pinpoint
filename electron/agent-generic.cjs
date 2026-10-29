// Runs any headless coding-agent CLI. Understands the JSON event streams of Claude-style CLIs (Amp, Qwen),
// Gemini CLI, Cursor Agent, OpenCode and Droid; anything else it prints is shown as the agent's reply.
const fs = require('node:fs');
const path = require('node:path');
const { spawnCli, lineReader, killProc, toolDetail } = require('./cli.cjs');
const { binOf } = require('./harnesses.cjs');

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : Array.isArray(v) ? v.map((x) => x?.text ?? str(x)).join('\n') : typeof v === 'object' ? (v.text ?? v.output ?? JSON.stringify(v)) : String(v));
const clip = (s) => str(s).slice(0, 2000);

// Cursor wraps tool calls as { readToolCall: { args } }, { shellToolCall: { args } }…
function cursorTool(tc = {}) {
  const key = Object.keys(tc)[0] || 'tool';
  const name = key.replace(/ToolCall$/, '').replace(/^\w/, (c) => c.toUpperCase());
  return { name, input: tc[key]?.args || {}, result: tc[key]?.result };
}

// Returns a list of Pinpoint agent events for one parsed JSON line, or null when the shape isn't recognised.
function translate(m, state) {
  const out = [];
  const sid = m.session_id || m.sessionId || m.sessionID || m.thread_id;
  if (sid && !state.sessionId) { state.sessionId = sid; out.push({ type: 'session', sessionId: sid, model: m.model }); }

  // Claude Code style: system / assistant / user / result
  if (m.type === 'system') return out;
  if (m.type === 'assistant' && m.message) {
    const content = Array.isArray(m.message.content) ? m.message.content : [{ type: 'text', text: str(m.message.content) }];
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) out.push({ type: 'text', text: b.text });
      else if (b.type === 'thinking' && b.thinking?.trim()) out.push({ type: 'thinking', text: b.thinking });
      else if (b.type === 'tool_use') out.push({ type: 'tool', id: b.id, name: b.name, detail: toolDetail(b.input) });
    }
    return out;
  }
  if (m.type === 'user' && Array.isArray(m.message?.content)) {
    for (const b of m.message.content) if (b.type === 'tool_result') out.push({ type: 'tool_result', id: b.tool_use_id, ok: !b.is_error, text: clip(b.content) });
    return out;
  }
  if (m.type === 'user') return out;

  // Cursor Agent: tool_call started / completed
  if (m.type === 'tool_call') {
    const t = cursorTool(m.tool_call);
    if (m.subtype === 'started') out.push({ type: 'tool', id: m.call_id, name: t.name, detail: toolDetail(t.input) });
    else out.push({ type: 'tool_result', id: m.call_id, ok: !t.result?.error && !t.result?.rejected, text: clip(t.result?.success ?? t.result) });
    return out;
  }

  // Gemini CLI: init / message / tool_use / tool_result / result
  if (m.type === 'init') return out;
  if (m.type === 'message') {
    if (m.role === 'assistant' && m.content) out.push({ type: m.delta ? 'text_delta' : 'text', text: str(m.content) });
    return out;
  }
  if (m.type === 'tool_use' && (m.tool_name || m.name)) {
    out.push({ type: 'tool', id: m.tool_id || m.id, name: m.tool_name || m.name, detail: toolDetail(m.parameters || m.input) });
    return out;
  }
  if (m.type === 'tool_result' && !m.part) {
    out.push({ type: 'tool_result', id: m.tool_id || m.id, ok: m.status !== 'error' && !m.is_error, text: clip(m.output ?? m.error?.message ?? m.content) });
    return out;
  }

  // OpenCode: events carry a `part`
  if (m.part) {
    const p = m.part;
    if (p.type === 'text' && p.text?.trim()) out.push({ type: 'text', text: p.text });
    else if (p.type === 'reasoning' && p.text?.trim()) out.push({ type: 'thinking', text: p.text });
    else if (p.type === 'tool' || m.type === 'tool_use') {
      const id = p.callID || p.id;
      out.push({ type: 'tool', id, name: p.tool || 'tool', detail: toolDetail(p.state?.input) });
      if (p.state?.status === 'completed' || p.state?.status === 'error') out.push({ type: 'tool_result', id, ok: p.state.status !== 'error', text: clip(p.state.output ?? p.state.error) });
    }
    return out;
  }

  if (m.type === 'error') { out.push({ type: 'error', text: str(m.message || m.error) || 'The agent reported an error' }); return out; }
  if (m.type === 'result' || m.type === 'completion' || m.type === 'done') {
    state.result = m;
    const failed = m.is_error || m.status === 'error' || m.subtype === 'error';
    if (failed) out.push({ type: 'error', text: str(m.result || m.error?.message || m.error) || 'The agent reported an error' });
    else if (!state.sawText && typeof m.result === 'string' && m.result.trim()) out.push({ type: 'text', text: m.result });
    return out;
  }
  if (m.type === 'step_start' || m.type === 'step_finish' || m.type === 'stats') return out;
  return out.length ? out : null;
}

function promptFile(requestDir, prompt, images) {
  const file = path.join(requestDir, 'prompt.md');
  const refs = images?.length ? `\n\nReference images (open them to look):\n${images.map((i) => `- ${i}`).join('\n')}\n` : '';
  fs.writeFileSync(file, prompt + refs);
  return file.split(path.sep).join('/');
}

function runGeneric(h, { settings, cwd, prompt, images, sessionId, requestDir, onEvent }) {
  // Long, multi-line prompts don't survive every shell's argument quoting, so the request travels as a file.
  const file = promptFile(requestDir, prompt, images);
  const pointer = `Your task is written in the file ${file} . Read that whole file first, then do what it asks in this project.`;
  const access = settings.agentAccess?.[h.id] || h.defaultAccess;
  const model = settings.agentModels?.[h.id] || '';
  const proc = spawnCli(binOf(settings, h), h.args({ prompt: pointer, model, access, sessionId: h.resumes ? sessionId : null }), cwd);

  const state = { sessionId: null, sawText: false, result: null };
  const started = Date.now();
  let finished = false;
  let cancelled = false;
  const emit = (evt) => {
    if (evt.type === 'text' || evt.type === 'text_delta') state.sawText = true;
    onEvent(evt);
  };
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    const r = state.result || {};
    onEvent({ type: 'done', ok, durationMs: r.duration_ms || r.stats?.duration_ms || Date.now() - started, cost: r.total_cost_usd, sessionId: state.sessionId || undefined });
  };

  lineReader(proc.stdout, (line) => {
    let m = null;
    if (line.startsWith('{')) { try { m = JSON.parse(line); } catch { m = null; } }
    const evts = m && translate(m, state);
    if (evts) { for (const e of evts) emit(e); return; }
    emit({ type: 'text_delta', text: line + '\n' });
  });
  lineReader(proc.stderr, (line) => onEvent({ type: 'log', text: line }));
  proc.stdin.on('error', () => {});
  proc.stdin.end();

  const done = new Promise((resolve) => {
    proc.on('error', (err) => { onEvent({ type: 'error', text: `Could not start ${h.name}: ${err.message}. Check its command in Settings.` }); finish(false); resolve(); });
    proc.on('close', (code) => {
      if (!finished) {
        if (cancelled) onEvent({ type: 'error', text: 'Stopped.' });
        else if (code !== 0) onEvent({ type: 'error', text: `${h.name} exited with code ${code}` });
        finish(!cancelled && code === 0);
      }
      resolve();
    });
  });

  return {
    done,
    steerable: false,
    steer: () => false,
    interrupt: () => false,
    kill() { cancelled = true; killProc(proc); },
  };
}

module.exports = { runGeneric, translate };
