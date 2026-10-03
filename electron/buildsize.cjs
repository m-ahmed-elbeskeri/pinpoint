// Production bundle size: runs the project's own build and adds up the JS and
// CSS it emits (raw and gzipped). The dev-server numbers on each run are only
// good for before/after; this is the size users actually download.
const { exec } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const project = require('./project.cjs');

const OUT_DIRS = ['dist', 'build', 'out', '.next/static', '.output/public', '.svelte-kit/output/client', 'public/build', '.vercel/output/static'];
const historyFile = (root) => path.join(root, '.pinpoint', 'build-size.json');

function readPkg(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return {}; }
}

// `next build` and `next dev` write to the same .next folder: the two can't run at once.
function sharesDevFolder(root) {
  const pkg = readPkg(root);
  return !!{ ...pkg.dependencies, ...pkg.devDependencies }.next;
}

function collect(dir, since, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') collect(abs, since, acc); continue; }
    const kind = /\.(m?js)$/.test(e.name) ? 'js' : /\.css$/.test(e.name) ? 'css' : null;
    if (!kind) continue;
    try {
      if (fs.statSync(abs).mtimeMs < since) continue; // left over from an older build
      const buf = fs.readFileSync(abs);
      acc[kind] += buf.length;
      acc[`${kind}Gzip`] += zlib.gzipSync(buf).length;
      acc.files++;
    } catch { /* vanished */ }
  }
}

function measure(root) {
  if (!readPkg(root).scripts?.build) return Promise.reject(new Error('This project has no "build" script in package.json.'));
  const started = Date.now() - 2000;
  return new Promise((resolve, reject) => {
    exec('npm run build', { cwd: root, timeout: 6 * 60 * 1000, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || stdout || err.message).trim().split('\n').filter(Boolean).slice(-3).join(' ');
        return reject(new Error(`The build failed: ${tail.slice(0, 300)}`));
      }
      const now = { js: 0, css: 0, jsGzip: 0, cssGzip: 0, files: 0, at: Date.now() };
      for (const d of OUT_DIRS) collect(path.join(root, d), started, now);
      if (!now.files) return reject(new Error("The build finished, but no JS or CSS output was found in the usual folders (dist, build, out, .next, .output)."));
      let previous = null;
      try { previous = JSON.parse(fs.readFileSync(historyFile(root), 'utf8')); } catch { /* first measurement */ }
      project.ensureDir(root);
      fs.writeFileSync(historyFile(root), JSON.stringify(now));
      resolve({ now, previous });
    });
  });
}

module.exports = { measure, sharesDevFolder };
