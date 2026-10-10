const CELL = 24;

function cellDiff(pa, pb, width, height, ignore) {
  const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
  const hits = new Uint16Array(cols * rows);
  const minX = new Int32Array(cols * rows).fill(width), minY = new Int32Array(cols * rows).fill(height);
  const maxX = new Int32Array(cols * rows), maxY = new Int32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) <= 60) continue;
      const c = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      hits[c]++;
      if (x < minX[c]) minX[c] = x;
      if (x > maxX[c]) maxX[c] = x;
      if (y < minY[c]) minY[c] = y;
      if (y > maxY[c]) maxY[c] = y;
    }
  }
  const cells = [];
  let px = 0;
  for (let c = 0; c < hits.length; c++) {
    if (hits[c] < 3 || ignore?.has(c)) continue;
    px += hits[c];
    cells.push({ i: c, x: minX[c], y: minY[c], w: maxX[c] - minX[c] + 1, h: maxY[c] - minY[c] + 1, px: hits[c] });
  }
  return { cells, px, total: cols * rows };
}

let worker = null;
let seq = 0;
const waiting = new Map();

function start() {
  const { Worker } = require('node:worker_threads');
  const w = new Worker(__filename);
  const fail = () => {
    if (worker === w) worker = null;
    for (const [id, job] of waiting) { waiting.delete(id); job.resolve(cellDiff(job.pa, job.pb, job.width, job.height, job.ignore)); }
  };
  w.on('message', ({ id, result }) => { const job = waiting.get(id); if (job) { waiting.delete(id); job.resolve(result); } });
  w.on('error', fail);
  w.on('exit', fail);
  w.unref();
  return w;
}

function cellDiffAsync(pa, pb, width, height, ignore) {
  return new Promise((resolve) => {
    const id = ++seq;
    const job = { pa, pb, width, height, ignore, resolve };
    try {
      worker ??= start();
      waiting.set(id, job);
      worker.postMessage({ id, pa, pb, width, height, ignore: ignore ? [...ignore] : null });
    } catch {
      waiting.delete(id);
      resolve(cellDiff(pa, pb, width, height, ignore));
    }
  });
}

const threads = require('node:worker_threads');
if (!threads.isMainThread && threads.parentPort) {
  threads.parentPort.on('message', ({ id, pa, pb, width, height, ignore }) => {
    threads.parentPort.postMessage({ id, result: cellDiff(pa, pb, width, height, ignore ? new Set(ignore) : undefined) });
  });
}

module.exports = { CELL, cellDiff, cellDiffAsync };
