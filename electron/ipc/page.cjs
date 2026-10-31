const { app, ipcMain, nativeImage, session, webContents } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const cssrules = require('../page/cssrules.cjs');
const engines = require('../page/engines.cjs');
const { sleep } = require('../fsutil.cjs');
const review = require('../page/review.cjs');
const routecheck = require('../page/routecheck.cjs');
const runs = require('../project/runs.cjs');
const sweep = require('../page/sweep.cjs');

function onWhite(img) {
  const { width, height } = img.getSize();
  if (!width || !height) return img;
  const scale = img.getScaleFactors()[0] || 1;
  const px = img.toBitmap({ scaleFactor: scale });
  let touched = false;
  for (let i = 3; i < px.length; i += 4) {
    const a = px[i];
    if (a === 255) continue;
    touched = true;
    const rest = 255 - a;
    px[i - 3] = Math.min(255, px[i - 3] + rest);
    px[i - 2] = Math.min(255, px[i - 2] + rest);
    px[i - 1] = Math.min(255, px[i - 1] + rest);
    px[i] = 255;
  }
  if (!touched) return img;
  return nativeImage.createFromBitmap(px, { width: Math.round(width * scale), height: Math.round(height * scale), scaleFactor: scale });
}

const cdpRoots = new Map();
const cdpSheets = new Map();
const netModes = new Map();
async function cdp(wc, method, params = {}) {
  if (!wc.debugger.isAttached()) {
    try { wc.debugger.attach('1.3'); }
    catch (err) { throw new Error(`Couldn't connect to the page (${err.message}). If the page's DevTools are open, close them and try again.`); }
    const id = wc.id;
    cdpSheets.set(id, new Map());
    wc.debugger.on('message', (_e, event, p) => {
      if (event === 'CSS.styleSheetAdded') cdpSheets.get(id)?.set(p.header.styleSheetId, p.header);
      else if (event === 'CSS.styleSheetRemoved') cdpSheets.get(id)?.delete(p.styleSheetId);
      else if (event === 'Fetch.requestPaused') onRequestPaused(wc, p);
    });
    wc.debugger.once('detach', () => { cdpRoots.delete(id); cdpSheets.delete(id); netModes.delete(id); netMocks.delete(id); });
  }
  return wc.debugger.sendCommand(method, params);
}

const netMocks = new Map();
const mockFor = (wc, request) => {
  const list = netMocks.get(wc.id);
  if (!list?.length) return null;
  let pathname = '';
  try { const u = new URL(request.url); pathname = u.pathname + u.search; } catch { return null; }
  const bare = pathname.split('?')[0];
  return list.find((m) => (m.method === 'ANY' || m.method === request.method) && (m.path === pathname || m.path === bare
    || (m.path.includes('*') && new RegExp('^' + m.path.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(bare)))) || null;
};
const wantsFetch = (wc) => netModes.has(wc.id) || !!netMocks.get(wc.id)?.length;

function onRequestPaused(wc, p) {
  const mode = netModes.get(wc.id);
  const send = (method, params) => wc.debugger.sendCommand(method, params).catch(() => { /* the page went away mid-request */ });
  const mock = mockFor(wc, p.request);
  if (mock) {
    let json = true;
    try { JSON.parse(mock.body); } catch { json = false; }
    return send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: mock.status || 200,
      responseHeaders: [{ name: 'content-type', value: json ? 'application/json' : 'text/plain; charset=utf-8' }, { name: 'access-control-allow-origin', value: '*' }, { name: 'x-pinpoint-mock', value: '1' }],
      body: Buffer.from(mock.body || '').toString('base64'),
    });
  }
  if (mode === 'hang') return;
  if (mode === 'error') {
    return send('Fetch.fulfillRequest', {
      requestId: p.requestId, responseCode: 500,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }],
      body: Buffer.from('{"error":"Simulated failure (Pinpoint)"}').toString('base64'),
    });
  }
  return send('Fetch.continueRequest', { requestId: p.requestId });
}

const guest = (id) => {
  const wc = webContents.fromId(id);
  if (!wc) throw new Error('webview not found');
  return wc;
};

async function queryNodes(wc, selector) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!cdpRoots.has(wc.id)) {
      await cdp(wc, 'DOM.enable');
      await cdp(wc, 'CSS.enable');
      cdpRoots.set(wc.id, (await cdp(wc, 'DOM.getDocument', { depth: 0 })).root.nodeId);
    }
    try { return (await cdp(wc, 'DOM.querySelectorAll', { nodeId: cdpRoots.get(wc.id), selector })).nodeIds; }
    catch (err) { cdpRoots.delete(wc.id); if (attempt) throw err; }
  }
  return [];
}

const THROTTLE = {
  normal: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  slow: { offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 },
  offline: { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 },
};

function register(ctx) {
  const { getWin, loadSettings, projectDir } = ctx;
  const watched = new WeakSet();
  function watchNetwork(ses = session.fromPartition(routecheck.PARTITION)) {
    if (watched.has(ses)) return;
    watched.add(ses);
    const report = (d, extra) => {
      if (routecheck.captureIds.has(d.webContentsId)) return;
      const win = getWin();
      if (!win || win.isDestroyed() || /favicon\.ico($|\?)/.test(d.url) || /^(devtools|chrome-extension):/.test(d.url)) return;
      win.webContents.send('page:network', { url: d.url, method: d.method, resourceType: d.resourceType, at: Date.now(), ...extra });
    };
    ses.webRequest.onCompleted((d) => { if (d.statusCode >= 400) report(d, { status: d.statusCode }); });
    ses.webRequest.onErrorOccurred((d) => { if (d.error !== 'net::ERR_ABORTED') report(d, { error: d.error }); });
  }
  ctx.watchNetwork = watchNetwork;

  ipcMain.handle('capture', async (_e, { webContentsId, rect, jpeg }) => {
    const wc = webContents.fromId(webContentsId);
    if (!wc) throw new Error('webview not found');
    const img = rect
      ? await wc.capturePage({
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        })
      : await wc.capturePage();
    if (jpeg && !img.isEmpty()) return `data:image/jpeg;base64,${onWhite(img).toJPEG(86).toString('base64')}`;
    return onWhite(img).toDataURL();
  });

  ipcMain.handle('page:force', async (_e, { webContentsId, selector, classes }) => {
    const wc = guest(webContentsId);
    if (!classes.length && !wc.debugger.isAttached()) return 0;
    const nodeIds = await queryNodes(wc, selector);
    for (const nodeId of nodeIds) await cdp(wc, 'CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
    return nodeIds.length;
  });

  ipcMain.handle('page:emulate', async (_e, { webContentsId, colorScheme, reducedMotion, focus, touch }) => {
    const wc = guest(webContentsId);
    if (!colorScheme && !reducedMotion && !focus && !touch && !wc.debugger.isAttached()) return true;
    await cdp(wc, 'Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: colorScheme || '' },
        { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : '' },
        { name: 'hover', value: touch ? 'none' : '' },
        { name: 'pointer', value: touch ? 'coarse' : '' },
        { name: 'any-hover', value: touch ? 'none' : '' },
        { name: 'any-pointer', value: touch ? 'coarse' : '' },
      ],
    });
    await cdp(wc, 'Emulation.setTouchEmulationEnabled', { enabled: !!touch, maxTouchPoints: touch ? 5 : 1 });
    await cdp(wc, 'Emulation.setEmitTouchEventsForMouse', { enabled: !!touch, configuration: 'mobile' });
    await cdp(wc, 'Emulation.setFocusEmulationEnabled', { enabled: !!focus });
    return true;
  });

  ipcMain.handle('page:rules', async (_e, { webContentsId, uid }) => {
    const wc = guest(webContentsId);
    const [nodeId] = await queryNodes(wc, `[data-pinpoint="${String(uid).replace(/[^\w-]/g, '')}"]`);
    if (!nodeId) return [];
    return cssrules.matched({ cdp: (m, p) => cdp(wc, m, p), nodeId, sheets: cdpSheets.get(wc.id) || new Map(), projectDir: loadSettings().projectDir });
  });

  ipcMain.handle('page:animation', async (_e, { webContentsId, rate }) => {
    const wc = guest(webContentsId);
    if (rate === 1 && !wc.debugger.isAttached()) return true;
    await cdp(wc, 'Animation.enable');
    await cdp(wc, 'Animation.setPlaybackRate', { playbackRate: rate });
    return true;
  });

  ipcMain.handle('page:network', async (_e, { webContentsId, mode }) => {
    const wc = guest(webContentsId);
    if (mode === 'normal' && !wc.debugger.isAttached()) return true;
    await cdp(wc, 'Network.enable');
    await cdp(wc, 'Network.emulateNetworkConditions', THROTTLE[mode] || THROTTLE.normal);
    if (mode === 'hang' || mode === 'error') {
      netModes.set(wc.id, mode);
      await cdp(wc, 'Fetch.enable', { patterns: [{ resourceType: 'XHR' }, { resourceType: 'Fetch' }] });
    } else {
      netModes.delete(wc.id);
      if (!wantsFetch(wc)) await cdp(wc, 'Fetch.disable').catch(() => { /* interception wasn't on */ });
    }
    return true;
  });

  ipcMain.handle('page:mocks', async (_e, { webContentsId, mocks }) => {
    const wc = guest(webContentsId);
    const list = (mocks || []).filter((m) => m && m.path).map((m) => ({ method: String(m.method || 'ANY').toUpperCase(), path: String(m.path), status: Number(m.status) || 200, body: String(m.body ?? '') }));
    if (!list.length && !wc.debugger.isAttached()) { netMocks.delete(wc.id); return true; }
    netMocks.set(wc.id, list);
    if (wantsFetch(wc)) await cdp(wc, 'Fetch.enable', { patterns: [{ resourceType: 'XHR' }, { resourceType: 'Fetch' }] });
    else await cdp(wc, 'Fetch.disable').catch(() => { /* interception wasn't on */ });
    return true;
  });

  ipcMain.handle('page:replay', async (_e, { webContentsId, steps }) => {
    const wc = guest(webContentsId);
    const find = (sel) => wc.executeJavaScript(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), checked: !!el.checked, tag: el.tagName };
    })()`).catch(() => null);
    const click = (p) => { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); };
    const press = (keyCode) => { for (const type of ['keyDown', 'char', 'keyUp']) wc.sendInputEvent({ type, keyCode }); };
    wc.focus();
    let done = 0;
    for (const s of steps) {
      if (s.type === 'navigate') { await sleep(700); done++; continue; }
      if (s.type === 'key') press(s.key);
      else {
        const p = s.selector ? await find(s.selector) : null;
        if (!p) break;
        if (s.type === 'click') click(p);
        else if (s.type === 'check') { if (String(p.checked) !== s.value) click(p); }
        else if (s.type === 'fill' && !s.secret) {
          if (p.tag === 'SELECT') {
            await wc.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(s.selector)}); el.value = ${JSON.stringify(s.value || '')}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`).catch(() => { /* element went away: the next step reports it */ });
          } else {
            click(p);
            await sleep(80);
            await wc.executeJavaScript('document.activeElement && document.activeElement.select && document.activeElement.select()').catch(() => { /* nothing selectable: type at the caret */ });
            if (s.value) await wc.insertText(s.value); else press('Backspace');
          }
        }
      }
      done++;
      await sleep(350);
    }
    return { done, total: steps.length };
  });

  ipcMain.handle('page:profile', async (_e, { webContentsId, locale, timezone, headers }) => {
    const wc = guest(webContentsId);
    watchNetwork(wc.session);
    const extra = { ...(locale && { 'Accept-Language': locale }), ...(headers || {}) };
    if (!locale && !timezone && !Object.keys(extra).length && !wc.debugger.isAttached()) return true;
    await cdp(wc, 'Emulation.setLocaleOverride', { locale: locale || '' }).catch(() => { /* not supported on this page */ });
    await cdp(wc, 'Emulation.setUserAgentOverride', { userAgent: wc.getUserAgent(), acceptLanguage: locale || undefined }).catch(() => { /* not supported on this page */ });
    await cdp(wc, 'Emulation.setTimezoneOverride', { timezoneId: timezone || '' }).catch(() => { /* not supported on this page */ });
    await cdp(wc, 'Network.enable');
    await cdp(wc, 'Network.setExtraHTTPHeaders', { headers: extra });
    return true;
  });

  ipcMain.handle('engines:status', () => engines.status(app.getPath('userData')));
  ipcMain.handle('engines:install', (e) => engines.install(app.getPath('userData'), (text) => { if (!e.sender.isDestroyed()) e.sender.send('engines:progress', text); }));

  ipcMain.handle('engines:shoot', async (_e, { webContentsId, url, width, height }) => {
    const wc = guest(webContentsId);
    let cookies = [];
    try {
      cookies = (await wc.session.cookies.get({ url })).map((c) => ({
        name: c.name, value: c.value, domain: c.domain, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly,
        ...(c.expirationDate && { expires: c.expirationDate }),
        ...(c.sameSite && c.sameSite !== 'unspecified' && { sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'strict' ? 'Strict' : 'Lax' }),
      }));
    } catch (err) { console.warn(`engine shots will render logged out: ${err.message}`); }
    const base = app.getPath('userData');
    const out = {};
    await Promise.all(engines.ENGINES.map(async (engine) => {
      try { out[engine] = `data:image/jpeg;base64,${(await engines.shoot(base, engine, url, { width, height, cookies })).toString('base64')}`; }
      catch (err) { out[engine] = { error: err.message }; }
    }));
    return out;
  });

  ipcMain.handle('sweep:start', (e, { pages, partition, crawl }) => {
    const root = projectDir();
    const send = (evt) => { if (!e.sender.isDestroyed()) e.sender.send('sweep:event', evt); };
    try { fs.rmSync(path.join(root, '.pinpoint', 'runs', 'sweep'), { recursive: true, force: true }); } catch { /* a locked old shot just stays until it is overwritten */ }
    sweep.run({
      pages, partition: partition || undefined, crawl: !!crawl, a11y: loadSettings().a11yCheck !== false,
      save: (name, buf) => runs.saveShotBuffer(root, 'sweep', name, buf), onEvent: send,
    }).catch((err) => send({ type: 'done', stopped: true, error: err.message }));
    return true;
  });
  ipcMain.handle('sweep:stop', () => { sweep.stop(); return true; });

  ipcMain.handle('review:start', (e, url) => review.start({ url, onComment: (c) => { if (!e.sender.isDestroyed()) e.sender.send('review:comment', c); } }));
  ipcMain.handle('review:stop', () => review.stop());
  ipcMain.handle('review:state', () => review.status());

  let axeSource = null;
  ipcMain.handle('a11y:source', () => (axeSource ??= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')));
}

module.exports = { register };
