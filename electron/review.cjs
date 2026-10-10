const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');

const PREFIX = '/__pinpoint_review';
const MAX_COMMENTS = 200;
const MAX_BODY = 64 * 1024;

function client() {
  if (window.__pinpointReview || window.top !== window) return;
  window.__pinpointReview = true;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;inset:auto 0 0 auto;';
  host.id = 'pinpoint-review';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<style>'
    + '*{box-sizing:border-box;font:13px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}'
    + '.pill{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;border:0;background:#111113;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer}'
    + '.pill.on{background:#ffd60a;color:#111113;font-weight:600}'
    + '.pill small{opacity:.7;font-size:11px}'
    + '.box{position:fixed;pointer-events:none;border:2px solid #ffd60a;background:rgba(255,214,10,.12);border-radius:3px;display:none}'
    + '.form{position:fixed;right:16px;bottom:64px;width:300px;max-width:calc(100vw - 32px);display:none;flex-direction:column;gap:8px;padding:12px;border-radius:12px;background:#17171a;color:#ececf1;box-shadow:0 16px 48px rgba(0,0,0,.5)}'
    + '.form b{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
    + '.form textarea,.form input{width:100%;padding:7px 9px;border-radius:8px;border:1px solid #33343f;background:#0d0e11;color:#ececf1;outline:0;resize:vertical}'
    + '.form textarea:focus,.form input:focus{border-color:#ffd60a}'
    + '.row{display:flex;gap:8px;justify-content:flex-end}'
    + '.row button{padding:6px 12px;border-radius:8px;border:1px solid #33343f;background:none;color:#ececf1;cursor:pointer}'
    + '.row .send{background:#ffd60a;border-color:#ffd60a;color:#111113;font-weight:600}'
    + '.row .page{margin-right:auto;border:0;padding:6px 0;color:#a9abb8;text-decoration:underline}'
    + '</style>'
    + '<div class="box"></div>'
    + '<div class="form"><b></b><textarea rows="3" placeholder="What should change here?"></textarea><input placeholder="Your name" maxlength="40"><div class="row"><button class="page" type="button">About the whole page</button><button class="cancel" type="button">Cancel</button><button class="send" type="button">Send</button></div></div>'
    + '<button class="pill" type="button"><span>Leave a comment</span><small></small></button>';
  document.documentElement.appendChild(host);
  const $ = (s) => root.querySelector(s);
  const pill = $('.pill'), box = $('.box'), form = $('.form'), label = $('.form b'), text = $('textarea'), who = $('input');
  let picking = false, target = null, sent = 0;
  try { who.value = localStorage.getItem('pinpoint-review-name') || ''; } catch (e) {}

  const selectorOf = (el) => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement && parts.length < 6; e = e.parentElement) {
      if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) { parts.unshift('#' + CSS.escape(e.id)); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? ':nth-of-type(' + (same.indexOf(e) + 1) + ')' : ''));
    }
    return parts.join(' > ');
  };
  const setPicking = (on) => {
    picking = on;
    pill.classList.toggle('on', on);
    pill.querySelector('span').textContent = on ? 'Click what you mean (Esc to cancel)' : 'Leave a comment';
    document.documentElement.style.cursor = on ? 'crosshair' : '';
    if (!on) box.style.display = 'none';
  };
  const open = (el) => {
    target = el;
    setPicking(false);
    const t = el ? (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : '';
    label.textContent = el ? '<' + el.tagName.toLowerCase() + '>' + (t ? ' "' + t.slice(0, 40) + '"' : '') : 'The whole page';
    form.style.display = 'flex';
    $('.page').style.display = el ? '' : 'none';
    text.focus();
  };
  const close = () => { form.style.display = 'none'; text.value = ''; target = null; };
  const ours = (e) => e.composedPath().includes(host);

  pill.addEventListener('click', () => { if (form.style.display === 'flex') close(); setPicking(!picking); });
  $('.cancel').addEventListener('click', close);
  $('.page').addEventListener('click', () => open(null));
  document.addEventListener('mousemove', (e) => {
    if (!picking || ours(e)) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    box.style.cssText = 'display:block;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
  }, true);
  document.addEventListener('click', (e) => {
    if (!picking || ours(e)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target instanceof Element ? e.target : document.elementFromPoint(e.clientX, e.clientY);
    if (el) open(el);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setPicking(false); close(); } }, true);
  $('.send').addEventListener('click', async () => {
    const body = text.value.trim();
    if (!body) { text.focus(); return; }
    try { localStorage.setItem('pinpoint-review-name', who.value.trim()); } catch (e) {}
    const r = target ? target.getBoundingClientRect() : null;
    const payload = {
      name: who.value.trim(), text: body, path: location.pathname + location.search,
      viewport: { width: innerWidth, height: innerHeight },
      ...(target && {
        selector: selectorOf(target), tag: target.tagName.toLowerCase(), classes: [...target.classList].slice(0, 12),
        elText: (target.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160), html: target.outerHTML.slice(0, 700),
        rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      }),
    };
    const send = $('.send');
    send.disabled = true;
    try {
      const res = await fetch('/__pinpoint_review/comment', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(String(res.status));
      sent++;
      pill.querySelector('small').textContent = sent + ' sent';
      close();
    } catch (err) { label.textContent = "Couldn't send it. Is the link still being shared?"; }
    send.disabled = false;
  });
}

const CLIENT = `(${client.toString()})();`;
const DENIED = '<!doctype html><meta charset="utf-8"><title>Review link</title><body style="font:15px system-ui;padding:40px;max-width:520px;margin:auto;color:#222"><h3>This review link is not open</h3><p>The link is incomplete, or the person who sent it has stopped sharing. Ask them for a new one.</p></body>';

let live = null;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
function clean(raw) {
  const c = {
    id: crypto.randomBytes(6).toString('hex'), at: Date.now(),
    name: str(raw.name, 40), text: str(raw.text, 2000), path: str(raw.path, 400) || '/',
    viewport: { width: Number(raw.viewport?.width) || 0, height: Number(raw.viewport?.height) || 0 },
  };
  if (typeof raw.selector === 'string' && raw.selector) {
    Object.assign(c, {
      selector: str(raw.selector, 400), tag: str(raw.tag, 30).replace(/[^a-z0-9-]/gi, '') || 'div',
      classes: Array.isArray(raw.classes) ? raw.classes.filter((k) => typeof k === 'string').slice(0, 12).map((k) => k.slice(0, 60)) : [],
      elText: str(raw.elText, 160), html: str(raw.html, 700),
      rect: { x: Number(raw.rect?.x) || 0, y: Number(raw.rect?.y) || 0, width: Number(raw.rect?.width) || 0, height: Number(raw.rect?.height) || 0 },
    });
  }
  return c.text.trim() ? c : null;
}

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

function status() {
  if (!live) return { running: false, urls: [], comments: [] };
  return { running: true, target: live.target.origin, port: live.port, urls: live.urls, comments: live.comments };
}

function stop() {
  if (!live) return status();
  const s = live;
  live = null;
  for (const sock of s.sockets) sock.destroy();
  s.server.close();
  return { running: false, urls: [], comments: s.comments };
}

function start({ url, onComment }) {
  stop();
  const target = new URL(url);
  if (!/^https?:$/.test(target.protocol)) throw new Error('Open a page served over http first.');
  const token = crypto.randomBytes(9).toString('base64url');
  const secure = target.protocol === 'https:';
  const upstreamPort = Number(target.port) || (secure ? 443 : 80);
  const allowed = (req) => (/(?:^|;\s*)pp_review=([^;]+)/.exec(req.headers.cookie || '') || [])[1] === token;
  const sockets = new Set();

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://review');
    if (u.searchParams.get('pp') === token) {
      u.searchParams.delete('pp');
      res.writeHead(302, { 'set-cookie': `pp_review=${token}; Path=/; HttpOnly; SameSite=Lax`, location: u.pathname + u.search, 'cache-control': 'no-store' });
      return res.end();
    }
    if (!allowed(req)) { res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }); return res.end(DENIED); }
    if (u.pathname === `${PREFIX}/client.js`) { res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' }); return res.end(CLIENT); }
    if (u.pathname === `${PREFIX}/comment`) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      const chunks = [];
      let size = 0;
      req.on('data', (d) => { size += d.length; if (size > MAX_BODY) req.destroy(); else chunks.push(d); });
      req.on('end', () => {
        let c = null;
        try { c = clean(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { c = null; }
        if (!c || !live || live.comments.length >= MAX_COMMENTS) { res.writeHead(400); return res.end(); }
        live.comments.push(c);
        try { onComment(c); } catch {  }
        res.writeHead(204);
        res.end();
      });
      return undefined;
    }
    const headers = { ...req.headers, host: target.host, 'accept-encoding': 'identity' };
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = target.origin + '/';
    const up = (secure ? https : http).request({ hostname: target.hostname, port: upstreamPort, method: req.method, path: req.url, headers, rejectUnauthorized: false }, (pr) => {
      const out = { ...pr.headers };
      delete out['content-security-policy'];
      delete out['content-security-policy-report-only'];
      if (typeof out.location === 'string' && out.location.startsWith(target.origin)) out.location = out.location.slice(target.origin.length) || '/';
      if (/text\/html/.test(String(pr.headers['content-type'] || '')) && req.method === 'GET') {
        const parts = [];
        pr.on('data', (d) => parts.push(d));
        pr.on('end', () => {
          const tag = `<script src="${PREFIX}/client.js" defer></script>`;
          let html = Buffer.concat(parts).toString('utf8');
          html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${tag}</body>`) : html + tag;
          delete out['content-length'];
          delete out['content-encoding'];
          delete out.etag;
          out['cache-control'] = 'no-store';
          res.writeHead(pr.statusCode || 200, out);
          res.end(html);
        });
      } else {
        res.writeHead(pr.statusCode || 200, out);
        pr.pipe(res);
      }
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('The site being reviewed is not answering. Its dev server may have stopped.'); });
    req.pipe(up);
    return undefined;
  });

  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  server.on('upgrade', (req, socket, head) => {
    if (!allowed(req)) return socket.destroy();
    const up = secure ? tls.connect({ host: target.hostname, port: upstreamPort, rejectUnauthorized: false, servername: target.hostname }) : net.connect(upstreamPort, target.hostname);
    const begin = () => {
      const headers = { ...req.headers, host: target.host };
      if (headers.origin) headers.origin = target.origin;
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`).join('')}\r\n`);
      if (head?.length) up.write(head);
      socket.pipe(up);
      up.pipe(socket);
    };
    up.once(secure ? 'secureConnect' : 'connect', begin);
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
    socket.on('close', () => up.destroy());
    return undefined;
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      const port = server.address().port;
      const path = target.pathname + target.search;
      const join = path.includes('?') ? '&' : '?';
      const urls = [...addresses(), 'localhost'].map((host) => `http://${host}:${port}${path}${join}pp=${token}`);
      live = { server, sockets, port, token, target, urls, comments: [] };
      resolve(status());
    });
  });
}

module.exports = { start, stop, status, clean };
