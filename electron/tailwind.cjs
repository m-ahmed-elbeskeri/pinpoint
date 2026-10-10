const { execFile } = require('node:child_process');

const SCRIPT = `
const fs = require('node:fs'), path = require('node:path');
const [root, entry, config, ...classes] = process.argv.slice(1);
const req = require('node:module').createRequire(path.join(root, 'package.json'));
(async () => {
  let v4 = null;
  try { v4 = req('@tailwindcss/node'); } catch {}
  if (v4 && v4.compile) {
    const input = entry ? fs.readFileSync(entry, 'utf8') : '@import "tailwindcss";';
    const compiler = await v4.compile(input, { base: entry ? path.dirname(entry) : root, onDependency() {} });
    return compiler.build(classes);
  }
  const tw = req('tailwindcss'), postcss = req('postcss');
  let cfg = {};
  try { if (config) cfg = req('tailwindcss/loadConfig')(config); } catch {}
  const out = await postcss([tw({ ...cfg, content: [{ raw: classes.join(' '), extension: 'html' }] })]).process('@tailwind utilities;', { from: undefined });
  return out.css;
})().then((css) => process.stdout.write(css), (e) => { process.stderr.write(String(e && e.message || e)); process.exit(1); });
`;

function pickLayers(css, keep) {
  if (!/@layer\s+[\w-]+\s*\{/.test(css)) return css;
  let out = '';
  const re = /@(layer|property)\s+([\w-]+)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    let depth = 1, i = re.lastIndex;
    for (; i < css.length && depth; i++) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; }
    if (m[1] === 'property' || keep.includes(m[2])) out += css.slice(m.index, i) + '\n';
    re.lastIndex = i;
  }
  return out;
}

const VALID = /^[\w\-:/.[\]()%#,!&>~+*'="@]+$/;

function generate(projectDir, files, classes) {
  const list = [...new Set(classes)].filter((c) => VALID.test(c) && c.length < 120).slice(0, 60);
  if (!list.length) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['-e', SCRIPT, projectDir, files.entry || '', files.config || '', ...list], {
      cwd: projectDir, timeout: 20000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().split('\n').pop()));
      resolve(pickLayers(String(stdout), ['theme', 'utilities']));
    });
  });
}

module.exports = { generate, pickLayers };
