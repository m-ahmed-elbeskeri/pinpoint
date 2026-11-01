// MCP servers and skills: what an agent has, and how a run leaves out the ones switched off in Pinpoint.
// Nothing here changes the CLI's own configuration, so its terminal sessions are unaffected.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnCli, killProc, lineReader, isWin } = require('./cli.cjs');

const PROBE_TIMEOUT = 30000;
const LIST_TIMEOUT = 15000;
// Claude Code's name for where a server was configured, and where that means it applies.
const MCP_SCOPE = { project: 'project', local: 'project', user: 'user', claudeai: 'connector' };
const MAX_PLUGIN_DEPTH = 8;
const MAX_PLUGIN_SKILLS = 1000;

const choices = (settings, agent) => settings.extensions?.[agent] || { mcp: {}, skills: {} };
const off = (map) => Object.entries(map || {}).filter(([, on]) => on === false).map(([name]) => name);

// Claude Code names MCP tools mcp__<server>__<tool>, with anything unusual in the server's name turned into _.
const mcpToolPrefix = (name) => `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function claudeArgs(settings) {
  const c = choices(settings, 'claude');
  const denied = [...off(c.mcp).map(mcpToolPrefix), ...off(c.skills).map((s) => `Skill(${s})`)];
  return denied.length ? ['--disallowedTools', ...denied] : [];
}

const tomlKey = (name) => (/^[\w-]+$/.test(name) ? name : `"${name.replace(/"/g, '\\"')}"`);

function codexArgs(settings) {
  const c = choices(settings, 'codex');
  const args = [];
  for (const [name, on] of Object.entries(c.mcp || {})) args.push('-c', `mcp_servers.${tomlKey(name)}.enabled=${on}`);
  const skills = off(c.skills);
  if (skills.length) args.push('-c', `skills.config=[${skills.map((p) => `{path="${p.split('\\').join('/')}",enabled=false}`).join(',')}]`);
  return args;
}

function skillInfo(file) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8').slice(0, 4000); } catch { return null; } // no SKILL.md: not a skill
  const head = (/^---\r?\n([\s\S]*?)\r?\n---/.exec(text) || [])[1] || '';
  const field = (k) => {
    const m = new RegExp(`^${k}:[ \\t]*(.*)((?:\\r?\\n[ \\t]+.*)*)`, 'm').exec(head);
    if (!m) return '';
    // A YAML block (description: >) continues on the indented lines below it.
    const first = /^[>|][+-]?$/.test(m[1].trim()) ? '' : m[1];
    return `${first} ${m[2]}`.replace(/\s+/g, ' ').trim().replace(/^["']|["']$/g, '');
  };
  return { name: field('name') || path.basename(path.dirname(file)), description: field('description') };
}

// Plugins keep their skills several folders down.
function pluginSkills() {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > MAX_PLUGIN_DEPTH || found.length >= MAX_PLUGIN_SKILLS) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } // not readable: skip it
    for (const e of entries) {
      if (e.isDirectory() && e.name !== 'node_modules') walk(path.join(dir, e.name), depth + 1);
      else if (e.name === 'SKILL.md') { const info = skillInfo(path.join(dir, e.name)); if (info) found.push({ ...info, source: 'plugin' }); }
    }
  };
  walk(path.join(os.homedir(), '.claude', 'plugins'), 0);
  return found;
}

function skillsIn(dir, source) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } // folder doesn't exist
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).flatMap((e) => {
    const file = path.join(dir, e.name, 'SKILL.md');
    const info = skillInfo(file);
    return info ? [{ ...info, source, file }] : [];
  });
}

// Claude Code reports everything it loaded, connectors and plugins included, when a session starts. The session ends right there.
function claudeSession(settings, cwd) {
  return new Promise((resolve) => {
    const proc = spawnCli(settings.claudePath || 'claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-turns', '1', '--permission-mode', 'plan'], cwd);
    let done = false;
    const end = (value) => { if (done) return; done = true; clearTimeout(stop); killProc(proc); resolve(value); };
    const stop = setTimeout(() => end(null), PROBE_TIMEOUT);
    lineReader(proc.stdout, (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; } // not every line is JSON
      if (m.type === 'system' && m.subtype === 'init') end(m);
    });
    proc.on('error', () => end(null));
    proc.on('exit', () => end(null));
    proc.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'ok' }] } })}\n`);
  });
}

async function listClaude(settings, cwd) {
  const init = await claudeSession(settings, cwd);
  if (!init) throw new Error("Claude Code didn't start, so its MCP servers and skills couldn't be listed.");
  const c = choices(settings, 'claude');
  const onDisk = [...skillsIn(path.join(cwd, '.claude', 'skills'), 'project'), ...skillsIn(path.join(os.homedir(), '.claude', 'skills'), 'user'), ...pluginSkills()];
  return {
    supported: true,
    mcp: (init.mcp_servers || []).map((s) => ({ id: s.name, name: s.name, status: s.status === 'pending' ? 'connecting' : s.status, scope: MCP_SCOPE[s.source] || 'plugin', enabled: c.mcp?.[s.name] !== false })),
    skills: (init.skills || []).map((name) => {
      const known = onDisk.find((s) => s.name === name);
      return { id: name, name, description: known?.description || '', scope: known?.source || 'plugin', enabled: c.skills?.[name] !== false };
    }),
  };
}

function codexMcp(settings, cwd) {
  return new Promise((resolve) => {
    const bin = settings.codexPath || 'codex';
    execFile(bin, ['mcp', 'list', '--json'], { cwd, shell: isWin, windowsHide: true, timeout: LIST_TIMEOUT }, (err, out) => {
      if (err) return resolve([]); // Codex missing or too old to list them: show none
      try { resolve(JSON.parse(out)); } catch { resolve([]); }
    });
  });
}

async function listCodex(settings, cwd) {
  const c = choices(settings, 'codex');
  const servers = await codexMcp(settings, cwd);
  const skills = [...skillsIn(path.join(cwd, '.agents', 'skills'), 'project'), ...skillsIn(path.join(os.homedir(), '.agents', 'skills'), 'user'), ...skillsIn(path.join(os.homedir(), '.codex', 'skills'), 'user')];
  return {
    supported: true,
    mcp: servers.map((s) => ({ id: s.name, name: s.name, status: s.enabled ? 'configured' : 'off in Codex', scope: 'user', enabled: c.mcp?.[s.name] ?? !!s.enabled })),
    skills: skills.map((s) => ({ id: s.file, name: s.name, description: s.description, scope: s.source, enabled: c.skills?.[s.file] !== false })),
  };
}

function list(settings, cwd) {
  if (settings.agent === 'claude') return listClaude(settings, cwd);
  if (settings.agent === 'codex') return listCodex(settings, cwd);
  return { supported: false, mcp: [], skills: [] };
}

module.exports = { list, claudeArgs, codexArgs, skillInfo };
