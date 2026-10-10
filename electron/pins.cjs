const fs = require('node:fs');
const path = require('node:path');
const project = require('./project.cjs');
const { shoot, compareAsync, nameAreas } = require('./routecheck.cjs');

const dir = (root) => path.join(root, '.pinpoint', 'pins');
const indexFile = (root) => path.join(dir(root), 'pins.json');
const safe = (id) => String(id).replace(/[^\w-]/g, '');
const img = (root, id, which) => path.join(dir(root), `${safe(id)}.${which}.jpg`);

function readAll(root) {
  try { return JSON.parse(fs.readFileSync(indexFile(root), 'utf8')); } catch { return []; }
}
const list = (root) => readAll(root).map(({ noisy: _n, noisyNow: _m, ...pin }) => pin);
function write(root, pins) {
  project.ensureDir(root);
  fs.mkdirSync(dir(root), { recursive: true });
  fs.writeFileSync(indexFile(root), JSON.stringify(pins, null, 2));
  return list(root);
}

async function add(root, { url, label }) {
  const shot = await shoot(url);
  if (!shot) throw new Error("Couldn't load that page to pin it.");
  const pins = readAll(root).filter((p) => p.url !== url);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  write(root, [...pins, { id, url, label: label || url, pinnedAt: Date.now(), pct: 0, changed: false, checkedAt: Date.now(), noisy: shot.noisy }]);
  fs.writeFileSync(img(root, id, 'base'), shot.jpg);
  return list(root);
}

async function check(root) {
  const pins = readAll(root);
  for (const p of pins) {
    const shot = await shoot(p.url);
    let base = null;
    try { base = fs.readFileSync(img(root, p.id, 'base')); } catch {  }
    p.checkedAt = Date.now();
    if (!shot || !base) { p.error = shot ? 'Baseline missing' : "Page didn't load"; p.changed = false; continue; }
    delete p.error;
    fs.writeFileSync(img(root, p.id, 'now'), shot.jpg);
    const diff = await compareAsync({ jpg: base, noisy: p.noisy }, shot);
    p.pct = diff.pct;
    p.changed = diff.changed;
    p.areas = diff.changed ? (await nameAreas(p.url, diff.areas)).areas : undefined;
    p.noisyNow = shot.noisy;
  }
  return write(root, pins);
}

const dataUrl = (file) => { try { return `data:image/jpeg;base64,${fs.readFileSync(file).toString('base64')}`; } catch { return null; } };
const images = (root, id) => ({ before: dataUrl(img(root, id, 'base')), after: dataUrl(img(root, id, 'now')) });

function accept(root, id) {
  try { fs.renameSync(img(root, id, 'now'), img(root, id, 'base')); } catch {  }
  return write(root, readAll(root).map((p) => (p.id === id ? { ...p, pct: 0, changed: false, areas: undefined, pinnedAt: Date.now(), noisy: p.noisyNow || p.noisy } : p)));
}

function remove(root, id) {
  for (const which of ['base', 'now']) fs.rmSync(img(root, id, which), { force: true });
  return write(root, readAll(root).filter((p) => p.id !== id));
}

module.exports = { list, add, check, images, accept, remove };
