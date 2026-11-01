const fs = require('node:fs');
const path = require('node:path');
const { spawnCli, lineReader, killProc, toolDetail } = require('./cli.cjs');
const { claudeArgs } = require('./extensions.cjs');

const GRACE_MS = 1200;
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;

function imageBlocks(images = []) {
  const out = [];
  for (const file of images.slice(0, MAX_IMAGES)) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { continue; }
    if (buf.length > MAX_IMAGE_BYTES) continue;
    const ext = path.extname(file).toLowerCase();
    const media = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/png';
    out.push({ type: 'text', text: `Image: ${file}` });
    out.push({ type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } });
  }
  return out;
}

const EDIT_CAP = 6000;
const clipEdit = (s) => (typeof s === 'string' ? (s.length > EDIT_CAP ? s.slice(0, EDIT_CAP) + '\n…' : s) : '');

// What an Edit / MultiEdit / Write step changed, so the chat can show a small diff.
function editsOf(name, input = {}) {
  if (name === 'Edit') return [{ old: clipEdit(input.old_string), new: clipEdit(input.new_string) }];
  if (name === 'MultiEdit') return (input.edits || []).slice(0, 20).map((e) => ({ old: clipEdit(e.old_string), new: clipEdit(e.new_string) }));
  if (name === 'Write') return [{ old: '', new: clipEdit(input.content) }];
  return undefined;
}

const PLAN_STATUS = { pending: 'pending', in_progress: 'in_progress', completed: 'completed' };

// Remembering "Always" for a run: per tool, and per command name for shell commands.
const approvalKey = (tool, input = {}) => (/^(Bash|PowerShell)$/.test(tool) ? `${tool}:${String(input.command || '').trim().split(/\s+/)[0]}` : tool);

function runClaude({ settings, cwd, prompt, images, sessionId, onEvent, askApproval }) {
  const mode = settings.claudePermission || 'acceptEdits';
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode', mode];
  // In "Edit files" mode, anything beyond edits (commands, web…) is asked about in the chat instead of being refused.
  if (askApproval && mode === 'acceptEdits') args.push('--permission-prompt-tool', 'stdio');
  const allowed = new Set();
  let contextWindow = 200000;
  if (sessionId) args.push('--resume', sessionId);
  if (settings.claudeModel) args.push('--model', settings.claudeModel);
  if (settings.claudeEffort) args.push('--effort', settings.claudeEffort);
  args.push(...claudeArgs(settings));

  const proc = spawnCli(settings.claudePath || 'claude', args, cwd);
  let finished = false;
  let closeTimer = null;
  let interruptWith = null;
  let cancelling = false;
  let reqSeq = 0;
  const totals = { cost: 0, durationMs: 0, turns: 0, sessionId };

  const write = (obj) => { if (!finished && proc.stdin.writable) proc.stdin.write(JSON.stringify(obj) + '\n'); };
  const sendUser = (text, imgs) => write({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }, ...imageBlocks(imgs)] } });
  const finish = (ok) => {
    if (finished) return;
    finished = true;
    onEvent({ type: 'done', ok, cost: totals.cost || undefined, durationMs: totals.durationMs || undefined, turns: totals.turns, sessionId: totals.sessionId });
    try { proc.stdin.end(); } catch { /* already closed */ }
  };

  lineReader(proc.stdout, (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return onEvent({ type: 'log', text: line }); }
    if (closeTimer && m.type !== 'result') { clearTimeout(closeTimer); closeTimer = null; }

    if (m.type === 'stream_event') {
      const ev = m.event;
      if (m.parent_tool_use_id || ev?.type !== 'content_block_delta') return;
      if (ev.delta?.type === 'text_delta') onEvent({ type: 'text_delta', text: ev.delta.text });
      else if (ev.delta?.type === 'thinking_delta') onEvent({ type: 'thinking_delta', text: ev.delta.thinking });
      return;
    }
    if (m.type === 'control_request' && m.request?.subtype === 'can_use_tool') {
      const { tool_name: tool, input = {}, permission_suggestions: suggestions } = m.request;
      const reply = (decision) => write({
        type: 'control_response',
        response: {
          subtype: 'success', request_id: m.request_id,
          response: decision === 'deny'
            ? { behavior: 'deny', message: 'The user declined this. Do something else or ask them.' }
            : { behavior: 'allow', updatedInput: input, ...(decision === 'always' && suggestions ? { updatedPermissions: suggestions } : {}) },
        },
      });
      const key = approvalKey(tool, input);
      if (allowed.has(key)) return reply('allow');
      Promise.resolve(askApproval ? askApproval({ tool, detail: toolDetail(input) || JSON.stringify(input).slice(0, 300) }) : 'deny').then((decision) => {
        if (decision === 'always') allowed.add(key);
        reply(decision);
      });
      return;
    }
    if (m.type === 'rate_limit_event' && m.rate_limit_info) {
      // Usage limits: warn before they bite, not only after.
      const r = m.rate_limit_info;
      const status = r.status === 'rejected' ? 'rejected' : r.status === 'allowed_warning' || (r.utilization ?? 0) >= 0.8 ? 'warning' : 'ok';
      onEvent({ type: 'limits', status, used: r.utilization != null ? Math.round(r.utilization * 100) : undefined, resetsAt: r.resetsAt ? r.resetsAt * (r.resetsAt < 1e12 ? 1000 : 1) : undefined, window: r.rateLimitType });
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      totals.sessionId = m.session_id;
      onEvent({ type: 'session', sessionId: m.session_id, model: m.model });
      if (Array.isArray(m.mcp_servers)) onEvent({ type: 'mcp', servers: m.mcp_servers.map((x) => ({ name: x.name, status: x.status })) });
    } else if (m.type === 'assistant' && m.message?.content && m.parent_tool_use_id) {
      // A subagent's own steps: shown nested under the Task step that started it.
      for (const b of m.message.content) {
        if (b.type === 'tool_use') onEvent({ type: 'tool', id: b.id, name: b.name, detail: toolDetail(b.input), parent: m.parent_tool_use_id, edits: editsOf(b.name, b.input) });
      }
    } else if (m.type === 'assistant' && m.message?.content) {
      const u = m.message.usage;
      if (u) onEvent({ type: 'usage', used: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0), window: contextWindow });
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text?.trim()) onEvent({ type: 'text', text: b.text });
        else if (b.type === 'thinking' && b.thinking?.trim()) onEvent({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use' && b.name === 'TodoWrite') {
          const steps = (b.input?.todos || []).map((t) => ({ text: t.status === 'in_progress' ? t.activeForm || t.content : t.content, status: PLAN_STATUS[t.status] || 'pending' }));
          if (steps.length) onEvent({ type: 'plan', steps });
        } else if (b.type === 'tool_use') onEvent({ type: 'tool', id: b.id, name: b.name, detail: toolDetail(b.input), edits: editsOf(b.name, b.input) });
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      for (const b of m.message.content) {
        if (b.type === 'tool_result') {
          const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c) => c.text || '').join('\n');
          onEvent({ type: 'tool_result', id: b.tool_use_id, ok: !b.is_error, text: text.slice(0, 2000) });
        }
      }
    } else if (m.type === 'result') {
      const win = Object.values(m.modelUsage || {}).map((x) => x.contextWindow).find(Boolean);
      if (win) contextWindow = win;
      totals.cost = m.total_cost_usd ?? totals.cost;
      totals.durationMs += m.duration_ms || 0;
      totals.turns += m.num_turns || 0;
      if (interruptWith != null) {
        const { text, images: imgs } = interruptWith;
        interruptWith = null;
        onEvent({ type: 'status', text: 'Interrupted. Continuing with your new message.' });
        sendUser(text, imgs);
        return;
      }
      if (cancelling) return finish(false);
      if (m.is_error && m.subtype !== 'error_during_execution') onEvent({ type: 'error', text: m.result || m.subtype || 'Claude Code reported an error' });
      const ok = !m.is_error;
      closeTimer = setTimeout(() => finish(ok), GRACE_MS);
    }
  });

  lineReader(proc.stderr, (line) => onEvent({ type: 'log', text: line }));
  proc.stdin.on('error', () => {});

  const done = new Promise((resolve) => {
    proc.on('error', (err) => {
      onEvent({ type: 'error', text: `Could not start Claude Code: ${err.message}. Check the CLI path in Settings.` });
      finish(false);
      resolve();
    });
    proc.on('close', (code) => {
      if (!finished) {
        if (cancelling) onEvent({ type: 'error', text: 'Stopped.' });
        else if (code !== 0) onEvent({ type: 'error', text: `Claude Code exited with code ${code}` });
        finish(!cancelling && code === 0);
      }
      resolve();
    });
  });

  sendUser(prompt, images);

  return {
    done,
    steerable: true,
    steer(text, imgs) {
      if (finished) return false;
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
      sendUser(text, imgs);
      return true;
    },
    interrupt(text, imgs) {
      if (finished) return false;
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; sendUser(text, imgs); return true; }
      interruptWith = { text, images: imgs };
      write({ type: 'control_request', request_id: `pp-${++reqSeq}`, request: { subtype: 'interrupt' } });
      return true;
    },
    kill() {
      if (finished) return;
      cancelling = true;
      interruptWith = null;
      write({ type: 'control_request', request_id: `pp-${++reqSeq}`, request: { subtype: 'interrupt' } });
      setTimeout(() => { if (!finished) { finish(false); killProc(proc); } }, 4000);
    },
  };
}

module.exports = { runClaude };
