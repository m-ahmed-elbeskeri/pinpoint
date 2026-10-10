const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const KEEP = 200_000;

let pty = null;
function lib() {
  if (!pty) pty = require('node-pty');
  return pty;
}

const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function onPath(name) {
  const exts = process.platform === 'win32' ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const full = path.join(dir, name + (name.toLowerCase().endsWith(ext.toLowerCase()) ? '' : ext));
      if (exists(full)) return full;
    }
  }
  return null;
}

let found = null;
function shells() {
  if (found && Date.now() - found.at < 60000) return found.list;
  found = { at: Date.now(), list: findShells() };
  return found.list;
}

function findShells() {
  const list = [];
  const add = (id, name, file, args = []) => { if (file && exists(file) && !list.some((s) => s.id === id)) list.push({ id, name, path: file, args }); };
  if (process.platform === 'win32') {
    const root = process.env.SystemRoot || 'C:\\Windows';
    const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
    add('pwsh', 'PowerShell 7', onPath('pwsh.exe') || pf.map((d) => path.join(d, 'PowerShell', '7', 'pwsh.exe')).find(exists), ['-NoLogo']);
    add('powershell', 'Windows PowerShell', path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoLogo']);
    add('cmd', 'Command Prompt', process.env.ComSpec || path.join(root, 'System32', 'cmd.exe'));
    const git = onPath('git.exe');
    const gitBash = [...pf.map((d) => path.join(d, 'Git', 'bin', 'bash.exe')), git && path.join(path.dirname(path.dirname(git)), 'bin', 'bash.exe')].filter(Boolean).find(exists);
    add('git-bash', 'Git Bash', gitBash, ['--login', '-i']);
    const wsl = path.join(root, 'System32', 'wsl.exe');
    if (exists(wsl)) {
      try {
        const out = execFileSync(wsl, ['-l', '-q'], { encoding: 'utf16le', timeout: 3000, windowsHide: true });
        if (out.replace(/\0/g, '').trim()) add('wsl', 'WSL', wsl);
      } catch {  }
    }
  } else {
    const names = { zsh: 'zsh', bash: 'Bash', fish: 'fish', sh: 'sh', nu: 'Nushell', pwsh: 'PowerShell', ksh: 'ksh', tcsh: 'tcsh', dash: 'dash' };
    let files = [];
    try { files = fs.readFileSync('/etc/shells', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')); } catch {  }
    for (const file of [process.env.SHELL, ...files, onPath('pwsh')].filter(Boolean)) {
      const base = path.basename(file);
      add(base, names[base] || base, file, base === 'pwsh' ? ['-NoLogo'] : ['-l']);
    }
    const order = ['zsh', 'bash', 'fish', 'nu', 'pwsh', 'ksh', 'tcsh', 'dash', 'sh'];
    const mine = process.env.SHELL ? path.basename(process.env.SHELL) : '';
    list.sort((a, b) => (a.id === mine ? -1 : b.id === mine ? 1 : (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99));
  }
  return list;
}

const sessions = new Map();
let counter = 0;

const describe = (s) => ({ id: s.id, shell: s.shell, name: s.name, exited: s.exited, cols: s.cols, rows: s.rows });

function open(sender, { shell, cwd, cols, rows }) {
  const all = shells();
  const pick = all.find((s) => s.id === shell) || all[0];
  if (!pick) throw new Error('No shell was found on this computer.');
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  delete env.ELECTRON_RUN_AS_NODE;
  let proc;
  try {
    proc = lib().spawn(pick.path, pick.args, { name: 'xterm-256color', cols: Math.max(20, cols || 80), rows: Math.max(5, rows || 24), cwd: dir, env });
  } catch (e) {
    throw new Error(`${pick.name} couldn't be started: ${e.message}`);
  }
  const s = { id: `t${++counter}`, shell: pick.id, name: pick.name, proc, buffer: '', exited: false, sender, cols: proc.cols, rows: proc.rows };
  sessions.set(s.id, s);
  const send = (channel, payload) => { if (!s.sender.isDestroyed()) s.sender.send(channel, payload); };
  const flush = () => {
    s.timer = null;
    if (!s.pending) return;
    send('term:data', { id: s.id, data: s.pending });
    s.pending = '';
  };
  proc.onData((data) => {
    s.buffer += data;
    if (s.buffer.length > KEEP * 2) s.buffer = s.buffer.slice(-KEEP);
    s.pending = (s.pending || '') + data;
    s.timer ||= setTimeout(flush, 8);
  });
  proc.onExit(({ exitCode }) => {
    clearTimeout(s.timer);
    flush();
    s.exited = true;
    send('term:exit', { id: s.id, code: exitCode });
  });
  return describe(s);
}

function list() { return [...sessions.values()].map(describe); }
function attach(sender, id) {
  const s = sessions.get(id);
  if (!s) return null;
  s.sender = sender;
  s.pending = '';
  return { ...describe(s), buffer: s.buffer.slice(-KEEP) };
}
function write(id, data) { const s = sessions.get(id); if (s && !s.exited) s.proc.write(data); }
function resize(id, cols, rows) {
  const s = sessions.get(id);
  if (!s || s.exited || !(cols > 1) || !(rows > 1)) return;
  try { s.proc.resize(Math.floor(cols), Math.floor(rows)); s.cols = Math.floor(cols); s.rows = Math.floor(rows); } catch {  }
}
function close(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (!s.exited) { try { s.proc.kill(); } catch {  } }
}
function closeAll() { for (const id of [...sessions.keys()]) close(id); }

module.exports = { shells, open, list, attach, write, resize, close, closeAll };
