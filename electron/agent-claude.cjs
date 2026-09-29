// Claude Code as a live session: `claude -p` with stream-json on stdin AND
// stdout, so messages can be sent while it works.
//   steer(text, images)     queued; Claude reads it right after its current tool call
//   interrupt(text, images) stops the current step, then continues with the new message
// The process stays open until a turn ends and nothing else is pending.
const fs = require('node:fs');
const path = require('node:path');
const { spawnCli, lineReader, killProc, toolDetail } = require('./cli.cjs');

const GRACE_MS = 1200; // after a result, wait briefly in case a queued message starts another turn
const MAX_IMAGES = 12;
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // base64 grows it by a third; the API caps images at 5 MB

// Screenshots go inline as image blocks so Claude sees them without having to
// open the files. Each is labeled with its path so the prompt's references line up.
function imageBlocks(images = []) {
  const out = [];
  for (const file of images.slice(0, MAX_IMAGES)) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { continue; }
    if (buf.length > MAX_IMAGE_BYTES) continue; // too big to inline; the path in the prompt still works
    const ext = path.extname(file).toLowerCase();
    const media = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/png';
    out.push({ type: 'text', text: `Image: ${file}` });
    out.push({ type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } });
  }
  return out;
}

function runClaude({ settings, cwd, prompt, images, sessionId, onEvent }) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--include-partial-messages', '--verbose', '--permission-mode', settings.claudePermission || 'acceptEdits'];
  if (sessionId) args.push('--resume', sessionId);
  if (settings.claudeModel) args.push('--model', settings.claudeModel);
  if (settings.claudeEffort) args.push('--effort', settings.claudeEffort);

  const proc = spawnCli(settings.claudePath || 'claude', args, cwd);
  let finished = false;
  let closeTimer = null;
  let interruptWith = null; // { text, images } to send once the interrupted turn reports its result
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
    // Any activity after a result means a queued message started a new turn.
    if (closeTimer && m.type !== 'result') { clearTimeout(closeTimer); closeTimer = null; }

    if (m.type === 'stream_event') {
      // Token-level deltas; the complete block still arrives later as 'assistant'.
      const ev = m.event;
      if (m.parent_tool_use_id || ev?.type !== 'content_block_delta') return;
      if (ev.delta?.type === 'text_delta') onEvent({ type: 'text_delta', text: ev.delta.text });
      else if (ev.delta?.type === 'thinking_delta') onEvent({ type: 'thinking_delta', text: ev.delta.thinking });
      return;
    }
    if (m.type === 'system' && m.subtype === 'init') {
      totals.sessionId = m.session_id;
      onEvent({ type: 'session', sessionId: m.session_id, model: m.model });
    } else if (m.type === 'assistant' && m.message?.content) {
      if (m.parent_tool_use_id) return; // sub-agent chatter; keep the transcript focused
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text?.trim()) onEvent({ type: 'text', text: b.text });
        else if (b.type === 'thinking' && b.thinking?.trim()) onEvent({ type: 'thinking', text: b.thinking });
        else if (b.type === 'tool_use') onEvent({ type: 'tool', id: b.id, name: b.name, detail: toolDetail(b.input) });
      }
    } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
      if (m.parent_tool_use_id) return;
      for (const b of m.message.content) {
        if (b.type === 'tool_result') {
          const text = typeof b.content === 'string' ? b.content : (b.content || []).map((c) => c.text || '').join('\n');
          onEvent({ type: 'tool_result', id: b.tool_use_id, ok: !b.is_error, text: text.slice(0, 2000) });
        }
      }
    } else if (m.type === 'result') {
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
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } // turn just ended: this starts the next
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
      // Graceful first; force it if the CLI doesn't wind down quickly.
      setTimeout(() => { if (!finished) { finish(false); killProc(proc); } }, 4000);
    },
  };
}

module.exports = { runClaude };
