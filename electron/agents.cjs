const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isWin } = require('./cli.cjs');
const { runClaude } = require('./agent-claude.cjs');
const { runCodex } = require('./agent-codex.cjs');
const { runGeneric } = require('./agent-generic.cjs');
const { harnesses, harness, binOf } = require('./harnesses.cjs');

function detectOne(bin) {
  return new Promise((resolve) => {
    execFile(bin, ['--version'], { timeout: 20000, shell: isWin, windowsHide: true }, (err, stdout) => {
      // A missing CLI fails at once; one killed for taking too long is installed, just slow to start.
      if (err && (err.killed || err.signal)) return resolve({ ok: true });
      resolve(err ? { ok: false } : { ok: true, version: String(stdout).trim().split('\n')[0] });
    });
  });
}

async function detectAgents(settings) {
  const list = harnesses(settings);
  const [claude, codex, ...rest] = await Promise.all([detectOne(settings.claudePath), detectOne(settings.codexPath), ...list.map((h) => detectOne(binOf(settings, h)))]);
  return { claude, codex, ...Object.fromEntries(list.map((h, i) => [h.id, rest[i]])) };
}

function runAgent(opts) {
  const id = opts.settings.agent;
  if (id === 'codex') return runCodex(opts);
  const h = id === 'claude' ? null : harness(opts.settings, id);
  return h ? runGeneric(h, opts) : runClaude(opts);
}

// What the renderer needs to list and configure every harness.
function harnessList(settings) {
  return [
    { id: 'claude', name: 'Claude Code', bin: 'claude', steerable: true },
    { id: 'codex', name: 'Codex', bin: 'codex', steerable: true },
    ...harnesses(settings).map((h) => ({ id: h.id, name: h.name, bin: h.bin, custom: !!h.custom, access: h.access, defaultAccess: h.defaultAccess, resumes: !!h.resumes })),
  ];
}

const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_MODELS = [
  { id: 'opus', label: 'Opus', desc: 'Latest Opus: strong and balanced', efforts: CLAUDE_EFFORTS },
  { id: 'fable', label: 'Fable', desc: 'Most capable; slower and pricier', efforts: CLAUDE_EFFORTS },
  { id: 'sonnet', label: 'Sonnet', desc: 'Fast and capable', efforts: CLAUDE_EFFORTS },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest, for small tweaks', efforts: [] },
];

function readCodexConfig() {
  try {
    const toml = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const top = toml.split(/^\[/m)[0];
    const get = (k) => (top.match(new RegExp('^' + k + '\\s*=\\s*"([^"]*)"', 'm')) || [])[1];
    return { model: get('model'), effort: get('model_reasoning_effort') };
  } catch { return {}; }
}

function codexModels() {
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
    const list = (cache.models || [])
      .filter((m) => m.visibility !== 'hide' && m.slug)
      .map((m) => ({
        id: m.slug,
        label: m.display_name || m.slug,
        desc: m.description || '',
        efforts: (m.supported_reasoning_levels || []).map((e) => e.effort || e).filter(Boolean),
        defaultEffort: m.default_reasoning_level,
      }));
    if (list.length) return list;
  } catch {  }
  const efforts = ['low', 'medium', 'high', 'xhigh'];
  return [
    { id: 'gpt-5.5', label: 'GPT-5.5', desc: '', efforts },
    { id: 'gpt-5.4', label: 'GPT-5.4', desc: '', efforts },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', desc: '', efforts },
  ];
}

function modelCatalog() {
  const cfg = readCodexConfig();
  return {
    claude: { models: CLAUDE_MODELS, defaultLabel: 'Claude Code default' },
    codex: { models: codexModels(), defaultModel: cfg.model, defaultEffort: cfg.effort, defaultLabel: cfg.model ? `Config default (${cfg.model})` : 'Config default' },
  };
}

module.exports = { runAgent, detectAgents, modelCatalog, harnessList };
