// What Pinpoint's MCP server offers. Page, chat and visual tools are answered by the window, which has the page and
// the chats; file claims live here, so they're shared by every run.
const { ipcMain } = require('electron');
const crypto = require('node:crypto');

const ASK_TIMEOUT_MS = 20000;
const ANSWER_TIMEOUT_MS = 15 * 60 * 1000; // how long a question waits for the user
const MAX_HTML = 300 * 1024;

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

const TOOLS = [
  { name: 'page_snapshot', readOnly: true, ask: true, description: "What the user sees in Pinpoint's browser right now: address, title, headings, links, buttons and form fields (each with a CSS selector), some of the visible text, and optionally a screenshot.", inputSchema: obj({ screenshot: { type: 'boolean', description: 'Include a screenshot of the visible page.' } }) },
  { name: 'page_console', readOnly: true, ask: true, description: "Recent errors and warnings in the page's console, and failed network requests. Check this after a change.", inputSchema: obj({}) },
  { name: 'selected_element', readOnly: true, ask: true, description: 'The element the user picked on the page, with its selector, text, size, main styles, the source file and line when known, and their note.', inputSchema: obj({}) },
  { name: 'page_navigate', ask: true, description: "Open an address in Pinpoint's browser, e.g. another route of the dev server.", inputSchema: obj({ url: str('Address or path, e.g. /pricing or http://localhost:3000/pricing') }, ['url']) },
  { name: 'page_click', ask: true, description: 'Click an element on the page, by CSS selector or by its visible text.', inputSchema: obj({ selector: str('CSS selector'), text: str('Visible text of a button or link, if there is no good selector') }) },
  { name: 'page_type', ask: true, description: 'Type into a field on the page, replacing its value.', inputSchema: obj({ selector: str('CSS selector of the input or textarea'), text: str('What to type') }, ['selector', 'text']) },
  { name: 'page_resize', ask: true, description: 'Preview the page at another size: a phone, a tablet or the full window, or an exact width and height.', inputSchema: obj({ preset: { type: 'string', enum: ['phone', 'tablet', 'full'] }, width: { type: 'number' }, height: { type: 'number' } }) },
  { name: 'list_sessions', readOnly: true, ask: true, description: 'The other chats, background tasks and side chats in this project: what each is doing, its status, its git branch, whether it is on your branch, the files it has touched and the files it has claimed.', inputSchema: obj({}) },
  { name: 'read_session', readOnly: true, ask: true, description: 'The recent conversation of another chat or background task, as text.', inputSchema: obj({ id: str('The id from list_sessions'), limit: { type: 'number', description: 'How many recent messages (default 20)' } }, ['id']) },
  { name: 'send_to_session', ask: true, description: 'Send a short message to another chat that is working right now. It reaches that agent after its current step and shows in its chat.', inputSchema: obj({ id: str('The id from list_sessions'), text: str('The message') }, ['id', 'text']) },
  { name: 'claim_files', description: "Tell other chats you're editing these files, so they leave them alone. Claims end when your run ends. Answers with any files another run has already claimed.", inputSchema: obj({ paths: { type: 'array', items: { type: 'string' }, description: 'Paths relative to the project' } }, ['paths']) },
  { name: 'release_files', description: 'Let go of files you claimed.', inputSchema: obj({ paths: { type: 'array', items: { type: 'string' } } }, ['paths']) },
  { name: 'ask_user', readOnly: true, ask: true, wait: true, description: 'Ask the user a question with options to pick, shown as buttons in the chat. Waits for their answer, which comes back as text. Use it when a choice is theirs to make (which approach, which page, yes or no), not for things you can find out yourself.', inputSchema: obj({ question: str('The question, in one or two sentences'), options: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'object', properties: { label: str('What the button says, a few words'), description: str('Optional: what picking it means') }, required: ['label'] } }, multi: { type: 'boolean', description: 'Let them pick more than one' } }, ['question', 'options']) },
  { name: 'show_visual', readOnly: true, ask: true, description: 'Show a chart, diagram, table or mockup in the chat, as a self-contained HTML page (inline CSS and JS, no network). Use it when a picture explains better than words.', inputSchema: obj({ html: str('A complete HTML document or fragment'), title: str('A short title'), height: { type: 'number', description: 'Height in pixels (default 320)' } }, ['html']) },
];

// Claims: path -> who. One map for every run, so every chat sees the same.
const claims = new Map();
const norm = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function releaseAll(runId) { for (const [p, c] of claims) if (c.runId === runId) claims.delete(p); }
const claimsOf = (runId) => [...claims].filter(([, c]) => c.runId === runId).map(([p]) => p);

// Questions for the window, which has the page and the chats.
let getWin = () => null;
const pending = new Map();
ipcMain.on('mcp:answer', (_e, { id, result, error }) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  clearTimeout(p.timer);
  if (error) p.reject(new Error(error)); else p.resolve(result);
});
function askWindow(tool, args, info, wait = ASK_TIMEOUT_MS) {
  const win = getWin();
  if (!win || win.isDestroyed()) return Promise.reject(new Error('The Pinpoint window is closed.'));
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(wait === ASK_TIMEOUT_MS ? 'Pinpoint took too long to answer.' : 'The user did not answer in time.')); }, wait);
    pending.set(id, { resolve, reject, timer });
    win.webContents.send('mcp:ask', { id, tool, args, run: { runId: info.runId, kind: info.kind, claims: Object.fromEntries([...claims].map(([p, c]) => [p, c.runId])) } });
  });
}

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });

async function callTool(tool, args, info) {
  if (tool.name === 'claim_files') {
    const taken = [];
    for (const raw of args.paths || []) {
      const p = norm(raw);
      const c = claims.get(p);
      if (c && c.runId !== info.runId) taken.push({ path: p, by: c.label });
      else claims.set(p, { runId: info.runId, label: info.label, at: Date.now() });
    }
    return text(taken.length ? { claimed: claimsOf(info.runId), alreadyClaimed: taken, note: 'Another chat is editing these. Leave them, or message it with send_to_session.' } : { claimed: claimsOf(info.runId) });
  }
  if (tool.name === 'release_files') {
    for (const raw of args.paths || []) { const p = norm(raw); if (claims.get(p)?.runId === info.runId) claims.delete(p); }
    return text({ claimed: claimsOf(info.runId) });
  }
  if (tool.name === 'show_visual' && String(args.html || '').length > MAX_HTML) throw new Error(`The page is too big to show (over ${MAX_HTML / 1024} KB).`);
  const result = await askWindow(tool.name, args, info, tool.wait ? ANSWER_TIMEOUT_MS : ASK_TIMEOUT_MS);
  if (result?.image) return { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }, { type: 'image', data: result.image, mimeType: 'image/jpeg' }] };
  return text(result);
}

function setWindow(fn) { getWin = fn; }

module.exports = { TOOLS, callTool, setWindow, releaseAll, claims };
