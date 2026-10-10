const OUT = process.env.PP_OUT || __dirname;
const FIX = process.env.PP_FIXTURES || __dirname;
const path = require('node:path'), fs = require('node:fs'), http = require('node:http');
const { app, nativeImage } = require('electron');
const repo = process.cwd();
const NL = String.fromCharCode(10);
const out = [];
const log = (name, ok, extra = '') => { out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + String(extra).slice(0, 300) : ''}`); fs.writeFileSync(path.join(OUT, 'engines.out'), out.join(NL) + NL); };

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><html><head><title>t</title></head><body style="margin:0;background:#fff"><div style="width:300px;height:200px;background:rgb(200,0,0)"></div><p id="who">cookie: ${req.headers.cookie || 'none'}</p><script>document.title = navigator.userAgent.includes('Firefox') ? 'firefox' : navigator.userAgent.includes('AppleWebKit') ? 'webkit' : 'other'</script></body></html>`);
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const engines = require(path.join(repo, 'electron', 'engines.cjs'));
  const base = path.join(FIX, 'engines-data');
  try {
    const before = engines.status(base);
    log('status before install', typeof before.ready === 'boolean', JSON.stringify(before));
    if (!before.ready) {
      let last = '';
      const t0 = Date.now();
      const after = await engines.install(base, (t) => { last = t; });
      log('install downloads both engines', after.ready === true, `${Math.round((Date.now() - t0) / 1000)}s, ${JSON.stringify(after)}, last: ${last}`);
    }
    for (const engine of engines.ENGINES) {
      const jpg = await engines.shoot(base, engine, url, { width: 800, height: 600, cookies: [{ name: 'who', value: 'admin', domain: '127.0.0.1', path: '/' }] });
      const img = nativeImage.createFromBuffer(jpg);
      const { width, height } = img.getSize();
      const px = img.toBitmap();
      const at = (x, y) => { const i = (y * width + x) * 4; return [px[i + 2], px[i + 1], px[i]]; };
      const red = at(50, 50), white = at(600, 400);
      log(`${engine}: renders the page at the asked size`, width === 800 && height === 600 && red[0] > 180 && red[1] < 40 && white[0] > 240 && white[1] > 240, `${width}x${height} red=${red} white=${white}`);
    }
    let failed = '';
    try { await engines.shoot(base, 'webkit', 'http://127.0.0.1:1/', {}); } catch (e) { failed = e.message; }
    log('a page that will not load reports an error instead of hanging', !!failed, failed);
  } catch (e) { log('exception', false, e.stack); }
  server.close();
  fs.appendFileSync(path.join(OUT, 'engines.out'), '[done]' + String.fromCharCode(10));
  app.exit(0);
});
