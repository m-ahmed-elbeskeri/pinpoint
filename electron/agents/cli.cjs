const { spawn } = require('node:child_process');

const isWin = process.platform === 'win32';

const q = (a) => (isWin && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

function spawnCli(bin, args, cwd) {
  return spawn(q(bin), args.map(q), {
    cwd,
    shell: isWin,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    windowsHide: true,
  });
}

function lineReader(stream, onLine) {
  let buf = '';
  stream.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  stream.on('end', () => { if (buf.trim()) onLine(buf.trim()); });
}

function killProc(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (isWin) spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
  else proc.kill('SIGTERM');
}

function toolDetail(input = {}) {
  return (
    input.file_path || input.path || input.notebook_path || input.command ||
    input.pattern || input.url || input.query || input.description || ''
  ).toString().slice(0, 300);
}

module.exports = { isWin, spawnCli, lineReader, killProc, toolDetail };
