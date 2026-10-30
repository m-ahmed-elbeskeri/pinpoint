const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const pp = (root, ...p) => path.join(root, '.pinpoint', ...p);
const safeId = (id) => String(id).replace(/[^\w-]/g, '');

function ensureDir(root) {
  fs.mkdirSync(pp(root), { recursive: true });
  const gi = pp(root, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

function listChats(root) {
  const dir = pp(root, 'chats');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const last = [...(c.items || [])].reverse().find((it) => it.kind === 'done' || it.kind === 'user');
      out.push({ id: c.id, title: c.renamed || c.title, renamed: !!c.renamed, pinned: !!c.pinned, archived: !!c.archived, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.items?.length || 0, agent: c.agent, branch: c.branch, failed: last?.kind === 'done' && !last.ok && !last.undone });
    } catch {  }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

function loadChat(root, id) {
  try { return JSON.parse(fs.readFileSync(pp(root, 'chats', `${safeId(id)}.json`), 'utf8')); }
  catch { return null; }
}

function saveChat(root, chat) {
  ensureDir(root);
  fs.mkdirSync(pp(root, 'chats'), { recursive: true });
  const items = (chat.items || []).slice(-400);
  // The app saves the conversation; names, pins and archiving set from the sidebar live in the same file and are kept.
  const prev = loadChat(root, chat.id) || {};
  const kept = { renamed: prev.renamed, pinned: prev.pinned, archived: prev.archived, branch: prev.branch || chat.branch };
  fs.writeFileSync(pp(root, 'chats', `${safeId(chat.id)}.json`), JSON.stringify({ ...chat, ...kept, items }));
  return true;
}

function patchChat(root, id, patch) {
  const c = loadChat(root, id);
  if (!c) return false;
  for (const k of ['renamed', 'pinned', 'archived']) if (k in patch) c[k] = patch[k] || undefined;
  fs.writeFileSync(pp(root, 'chats', `${safeId(id)}.json`), JSON.stringify(c));
  return true;
}

// Chats whose words contain the query, with a snippet around the first hit.
function searchChats(root, query) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const dir = pp(root, 'chats');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    let c;
    try { c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const it of c.items || []) {
      const text = it.kind === 'user' || it.kind === 'text' ? String(it.text || '') : '';
      const at = text.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const snippet = text.slice(Math.max(0, at - 40), at + q.length + 60).replace(/\s+/g, ' ').trim();
      out.push({ id: c.id, title: c.renamed || c.title, updatedAt: c.updatedAt, snippet });
      break;
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
}

// A chat as Markdown, for sharing or keeping.
function chatMarkdown(c) {
  const lines = [`# ${c.renamed || c.title || 'Chat'}`, '', `_${new Date(c.createdAt || Date.now()).toLocaleString()} · ${c.agent === 'codex' ? 'Codex' : c.agent === 'claude' ? 'Claude Code' : c.agent || ''}_`, ''];
  for (const it of c.items || []) {
    if (it.kind === 'user') {
      lines.push('## You', '');
      if (it.text) lines.push(it.text, '');
      for (const a of it.annotations || []) if (a.note) lines.push(`- **${a.n}.** ${a.note}`);
      if ((it.annotations || []).some((a) => a.note)) lines.push('');
    } else if (it.kind === 'text') lines.push(it.text, '');
    else if (it.kind === 'tool') lines.push(`- \`${it.name}\` ${it.detail || ''}`.trimEnd());
    else if (it.kind === 'plan') lines.push('', ...it.steps.map((x) => `- [${x.status === 'completed' ? 'x' : ' '}] ${x.text}`), '');
    else if (it.kind === 'done') lines.push('', `> ${it.ok ? 'Done' : 'Stopped'}${it.changes?.length ? ` · changed ${it.changes.map((x) => '`' + x.path + '`').join(', ')}` : ''}`, '');
    else if (it.kind === 'error') lines.push(`> ⚠ ${it.text}`, '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function deleteChat(root, id) {
  fs.rmSync(pp(root, 'chats', `${safeId(id)}.json`), { force: true });
  return true;
}

const designPath = (root) => path.join(root, 'DESIGN.md');

function readDesign(root) {
  const p = designPath(root);
  try { return { path: p, exists: true, content: fs.readFileSync(p, 'utf8') }; }
  catch { return { path: p, exists: false, content: '' }; }
}

function writeDesign(root, content) {
  const p = designPath(root);
  if (!content.trim()) { fs.rmSync(p, { force: true }); return { path: p, exists: false, content: '' }; }
  fs.writeFileSync(p, content);
  return { path: p, exists: true, content };
}

// Rules shared with the team live in PINPOINT.md, which is committed; .pinpoint/ stays private to this machine.
const sharedPath = (root) => path.join(root, 'PINPOINT.md');
const SHARED_HEAD = '# Project rules\n\nRules for coding agents working here, kept by Pinpoint. Each bullet is sent with every request.\n';
const sharedId = (text) => `shared-${crypto.createHash('sha1').update(text).digest('hex').slice(0, 12)}`;

function readShared(root) {
  let text = '';
  try { text = fs.readFileSync(sharedPath(root), 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).flatMap((l) => {
    const m = l.match(/^\s*[-*]\s+(.+?)\s*$/);
    return m ? [m[1]] : [];
  });
}

function readLocalMemory(root) {
  try { return JSON.parse(fs.readFileSync(pp(root, 'memory.json'), 'utf8')); }
  catch { return []; }
}

function readMemory(root) {
  const local = readLocalMemory(root);
  const off = new Set(local.filter((m) => m.shared && m.enabled === false).map((m) => m.id));
  const shared = readShared(root).map((text) => {
    const id = sharedId(text);
    return { id, text, enabled: !off.has(id), shared: true, createdAt: 0 };
  });
  return [...shared, ...local.filter((m) => !m.shared)];
}

function writeMemory(root, items) {
  ensureDir(root);
  const shared = items.filter((m) => m.shared && m.text?.trim());
  const before = readShared(root);
  const lines = shared.map((m) => m.text.trim().replace(/\s*\n\s*/g, ' '));
  if (lines.join('\n') !== before.join('\n')) {
    if (!lines.length) {
      // Only the rules are ours: a file with other writing in it stays, without its bullets.
      let rest = '';
      try { rest = fs.readFileSync(sharedPath(root), 'utf8').split(/\r?\n/).filter((l) => !/^\s*[-*]\s+/.test(l)).join('\n').trim(); } catch { /* no file */ }
      if (rest && `${rest}\n` !== SHARED_HEAD.trim() + '\n') fs.writeFileSync(sharedPath(root), `${rest}\n`);
      else fs.rmSync(sharedPath(root), { force: true });
    } else {
      let head = SHARED_HEAD;
      try {
        const kept = fs.readFileSync(sharedPath(root), 'utf8').split(/\r?\n/).filter((l) => !/^\s*[-*]\s+/.test(l)).join('\n').trim();
        if (kept) head = `${kept}\n`;
      } catch { /* a new file */ }
      fs.writeFileSync(sharedPath(root), `${head}\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
    }
  }
  // Switching a shared rule off is personal: it is remembered here and doesn't touch the file.
  const local = [
    ...items.filter((m) => !m.shared),
    ...lines.map((text) => ({ id: sharedId(text), text })).filter((x) => shared.some((m) => m.enabled === false && m.text.trim().replace(/\s*\n\s*/g, ' ') === x.text)).map((x) => ({ ...x, shared: true, enabled: false })),
  ];
  fs.writeFileSync(pp(root, 'memory.json'), JSON.stringify(local, null, 2));
  return readMemory(root);
}

// A chat packed to hand to a teammate. Sessions and runs only exist on this machine, so runs become plain notes;
// the new agent gets the conversation as text the first time it is asked something.
function packThread(chat) {
  return { pinpointThread: 1, chat: { title: chat.renamed || chat.title, createdAt: chat.createdAt, agent: chat.agent, branch: chat.branch, items: chat.items || [] } };
}

function unpackThread(data, id, now = Date.now()) {
  if (data?.pinpointThread !== 1 || !Array.isArray(data.chat?.items)) throw new Error("That file isn't a Pinpoint chat.");
  const note = (text, i) => ({ kind: 'status', id: `${id}-n${i}`, text });
  const items = data.chat.items.flatMap((it, i) => {
    if (it.kind === 'approval') return [];
    if (it.kind !== 'done') return [it];
    const files = (it.changes || []).filter((c) => !c.reverted).map((c) => c.path);
    return [note(`${it.undone ? 'Run undone' : it.ok ? 'Run finished' : 'Run stopped'}${files.length && !it.undone ? `: changed ${files.join(', ')}` : ''}`, i)];
  });
  items.push(note(`Handed over${data.chat.branch ? ` from branch ${data.chat.branch}` : ''}. Their uncommitted changes aren't included.`, 'end'));
  return { id, title: data.chat.title || 'Handed-over chat', createdAt: now, updatedAt: now, agent: data.chat.agent, branch: data.chat.branch, session: null, items };
}

// One file for the code viewer: never outside the project, and capped so a huge or binary file can't stall the window.
const VIEW_LIMIT = 1024 * 1024;
function readProjectFile(root, rel) {
  const base = fs.realpathSync(root);
  const abs = fs.realpathSync(path.resolve(base, String(rel)));
  if (abs !== base && !abs.startsWith(base + path.sep)) throw new Error('Path is outside the project.');
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new Error('Not a file.');
  const fd = fs.openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(Math.min(st.size, VIEW_LIMIT));
    fs.readSync(fd, buf, 0, buf.length, 0);
    if (buf.includes(0)) return { binary: true, size: st.size, text: '', truncated: false };
    return { binary: false, size: st.size, text: buf.toString('utf8'), truncated: st.size > VIEW_LIMIT };
  } finally { fs.closeSync(fd); }
}

function readProfiles(root) {
  try { return JSON.parse(fs.readFileSync(pp(root, 'profiles.json'), 'utf8')); }
  catch { return []; }
}

function writeProfiles(root, list) {
  ensureDir(root);
  fs.writeFileSync(pp(root, 'profiles.json'), JSON.stringify(list, null, 2));
  return list;
}

module.exports = { ensureDir, listChats, loadChat, saveChat, deleteChat, readDesign, writeDesign, readMemory, writeMemory, readProfiles, writeProfiles, patchChat, searchChats, chatMarkdown, packThread, unpackThread, readProjectFile };
