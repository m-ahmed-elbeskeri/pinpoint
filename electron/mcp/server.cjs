// Pinpoint's own MCP server, for the agents it runs. Plain JSON-RPC over HTTP on 127.0.0.1 (MCP's streamable
// HTTP transport, answering with JSON rather than a stream), so no separate program is needed.
// Each run gets a token that says which run is calling; a run's token stops working when the run ends.
const crypto = require('node:crypto');
const http = require('node:http');
const { TOOLS, callTool } = require('./tools.cjs');

const PROTOCOL = '2025-06-18';
const MAX_BODY = 4 * 1024 * 1024;

const tokens = new Map();
let server = null;
let port = 0;

function start() {
  if (server) return Promise.resolve(port);
  return new Promise((resolve, reject) => {
    server = http.createServer(handle);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(port); });
  });
}

// A token for one run. `readOnly` runs (side chats, plan mode) get only the tools that change nothing.
async function issue(info) {
  await start();
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, info);
  return { token, url: `http://127.0.0.1:${port}/mcp` };
}

function revoke(token) { if (token) tokens.delete(token); }

const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body == null ? '' : JSON.stringify(body));
};

function handle(req, res) {
  if (req.url !== '/mcp') return reply(res, 404, { error: 'not found' });
  const auth = /^Bearer (\w+)$/.exec(req.headers.authorization || '');
  const info = auth && tokens.get(auth[1]);
  if (!info) return reply(res, 401, { error: 'This token is not for a running Pinpoint run.' });
  if (req.method === 'DELETE') return reply(res, 200, {});
  if (req.method !== 'POST') return reply(res, 405, { error: 'POST only' }, { allow: 'POST' });
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > MAX_BODY) req.destroy(); });
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(body); } catch { return reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    const answer = async (m) => {
      if (m.id === undefined) return null; // a notification: nothing to say back
      try { return { jsonrpc: '2.0', id: m.id, result: await method(m, info) }; }
      catch (e) { return { jsonrpc: '2.0', id: m.id, error: { code: e.code || -32603, message: e.message } }; }
    };
    const out = Array.isArray(msg) ? (await Promise.all(msg.map(answer))).filter(Boolean) : await answer(msg);
    if (out == null || (Array.isArray(out) && !out.length)) return reply(res, 202, null);
    reply(res, 200, out, { 'mcp-session-id': info.session || (info.session = crypto.randomUUID()) });
  });
}

async function method(m, info) {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: m.params?.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'pinpoint', version: '1' }, instructions: 'Tools from Pinpoint, the app showing the user\'s site: see the page, the other chats working on this project, and show visuals in the chat.' };
    case 'ping': return {};
    case 'tools/list': return { tools: TOOLS.filter((t) => !info.readOnly || t.readOnly).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool || (info.readOnly && !tool.readOnly)) throw Object.assign(new Error(`No tool called ${m.params?.name}`), { code: -32602 });
      try { return await callTool(tool, m.params.arguments || {}, info); }
      catch (e) { return { isError: true, content: [{ type: 'text', text: e.message }] }; }
    }
    default: throw Object.assign(new Error(`Unknown method ${m.method}`), { code: -32601 });
  }
}

function stop() { server?.close(); server = null; tokens.clear(); }

module.exports = { start, issue, revoke, stop };
