const fs = require('node:fs');
const path = require('node:path');

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

function readMemory(root) {
  try { return JSON.parse(fs.readFileSync(pp(root, 'memory.json'), 'utf8')); }
  catch { return []; }
}

function writeMemory(root, items) {
  ensureDir(root);
  fs.writeFileSync(pp(root, 'memory.json'), JSON.stringify(items, null, 2));
  return items;
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

module.exports = { ensureDir, listChats, loadChat, saveChat, deleteChat, readDesign, writeDesign, readMemory, writeMemory, readProfiles, writeProfiles, patchChat, searchChats, chatMarkdown };
