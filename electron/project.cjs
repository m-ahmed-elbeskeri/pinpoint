// Per-project state: chat history (.pinpoint/chats), personal memory
// (.pinpoint/memory.json) and shared design rules (DESIGN.md at the root).
const fs = require('node:fs');
const path = require('node:path');

const pp = (root, ...p) => path.join(root, '.pinpoint', ...p);
const safeId = (id) => String(id).replace(/[^\w-]/g, '');

function ensureDir(root) {
  fs.mkdirSync(pp(root), { recursive: true });
  const gi = pp(root, '.gitignore');
  // Self-ignoring folder, so we never touch the user's own .gitignore.
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
}

// ---------- chats ----------
function listChats(root) {
  const dir = pp(root, 'chats');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      out.push({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, count: c.items?.length || 0, agent: c.agent });
    } catch { /* skip corrupt */ }
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
  fs.writeFileSync(pp(root, 'chats', `${safeId(chat.id)}.json`), JSON.stringify({ ...chat, items }));
  return true;
}

function deleteChat(root, id) {
  fs.rmSync(pp(root, 'chats', `${safeId(id)}.json`), { force: true });
  return true;
}

// ---------- design rules ----------
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

// ---------- memory ----------
function readMemory(root) {
  try { return JSON.parse(fs.readFileSync(pp(root, 'memory.json'), 'utf8')); }
  catch { return []; }
}

function writeMemory(root, items) {
  ensureDir(root);
  fs.writeFileSync(pp(root, 'memory.json'), JSON.stringify(items, null, 2));
  return items;
}

module.exports = { ensureDir, listChats, loadChat, saveChat, deleteChat, readDesign, writeDesign, readMemory, writeMemory };
