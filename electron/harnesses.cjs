// Coding-agent CLIs Pinpoint can drive besides Claude Code and Codex (which have their own adapters).
// Each entry builds the headless command line; agent-generic.cjs reads whatever it prints.

const BUILTIN = [
  {
    id: 'gemini', name: 'Gemini CLI', bin: 'gemini',
    access: [
      { value: 'plan', label: 'Plan only', desc: 'Read-only; no files are changed' },
      { value: 'auto_edit', label: 'Edit files', desc: 'Auto-approves file edits' },
      { value: 'yolo', label: 'Full access', desc: 'Auto-approves every tool, commands included' },
    ],
    defaultAccess: 'auto_edit',
    args: ({ prompt, model, access }) => ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', access, ...(model ? ['-m', model] : [])],
  },
  {
    id: 'qwen', name: 'Qwen Code', bin: 'qwen',
    access: [
      { value: 'plan', label: 'Plan only', desc: 'Read-only; no files are changed' },
      { value: 'auto-edit', label: 'Edit files', desc: 'Auto-approves file edits' },
      { value: 'yolo', label: 'Full access', desc: 'Auto-approves every tool' },
    ],
    defaultAccess: 'auto-edit',
    args: ({ prompt, model, access }) => ['-p', prompt, '--output-format', 'stream-json', '--approval-mode', access, ...(model ? ['-m', model] : [])],
  },
  {
    id: 'cursor', name: 'Cursor Agent', bin: 'cursor-agent',
    access: [
      { value: 'ask', label: 'Plan only', desc: 'Proposes changes without writing them' },
      { value: 'force', label: 'Full access', desc: 'Writes files and runs commands' },
    ],
    defaultAccess: 'force',
    args: ({ prompt, model, access, sessionId }) => ['-p', prompt, '--output-format', 'stream-json', ...(access === 'force' ? ['--force'] : []), ...(model ? ['--model', model] : []), ...(sessionId ? ['--resume', sessionId] : [])],
    resumes: true,
  },
  {
    id: 'opencode', name: 'OpenCode', bin: 'opencode',
    args: ({ prompt, model, sessionId }) => ['run', '--format', 'json', ...(model ? ['-m', model] : []), ...(sessionId ? ['--session', sessionId] : []), prompt],
    resumes: true,
  },
  {
    id: 'amp', name: 'Amp', bin: 'amp',
    access: [
      { value: 'ask', label: 'Default', desc: "Uses Amp's own permission rules" },
      { value: 'all', label: 'Full access', desc: 'Allows every tool without asking' },
    ],
    defaultAccess: 'all',
    args: ({ prompt, access }) => ['-x', prompt, '--stream-json', ...(access === 'all' ? ['--dangerously-allow-all'] : [])],
  },
  {
    id: 'droid', name: 'Factory Droid', bin: 'droid',
    access: [
      { value: 'low', label: 'Edit files', desc: 'File edits only' },
      { value: 'medium', label: 'Edit and build', desc: 'Edits plus reversible commands' },
      { value: 'high', label: 'Full access', desc: 'Any command' },
    ],
    defaultAccess: 'low',
    args: ({ prompt, model, access }) => ['exec', '--output-format', 'stream-json', '--auto', access, ...(model ? ['-m', model] : []), prompt],
  },
  {
    id: 'copilot', name: 'GitHub Copilot CLI', bin: 'copilot',
    access: [
      { value: 'tools', label: 'Full access', desc: 'Allows every tool without asking' },
    ],
    defaultAccess: 'tools',
    args: ({ prompt, model }) => ['-p', prompt, '--allow-all-tools', ...(model ? ['--model', model] : [])],
  },
  {
    id: 'goose', name: 'Goose', bin: 'goose',
    args: ({ prompt }) => ['run', '--no-session', '-t', prompt],
  },
  {
    id: 'aider', name: 'Aider', bin: 'aider',
    args: ({ prompt, model }) => ['--message', prompt, '--yes-always', '--no-pretty', '--no-stream', ...(model ? ['--model', model] : [])],
  },
];

// "my-agent run {prompt} --json" → ['run', '<prompt>', '--json']
function splitArgs(template) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(template || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function customHarness(c) {
  return {
    id: c.id, name: c.name || c.command, bin: c.command, custom: true,
    args: ({ prompt, model }) => {
      const parts = splitArgs(c.args || '{prompt}').map((a) => a.replace('{prompt}', prompt).replace('{model}', model || ''));
      if (!(c.args || '').includes('{prompt}')) parts.push(prompt);
      return parts.filter((a) => a !== '');
    },
  };
}

function harnesses(settings) {
  return [...BUILTIN, ...(settings.customAgents || []).filter((c) => c.id && c.command).map(customHarness)];
}

function harness(settings, id) {
  return harnesses(settings).find((h) => h.id === id) || null;
}

function binOf(settings, h) {
  return settings.agentPaths?.[h.id] || h.bin;
}

const NAMES = { claude: 'Claude Code', codex: 'Codex' };
function agentName(settings, id = settings.agent) {
  return NAMES[id] || harness(settings, id)?.name || id;
}

module.exports = { BUILTIN, harnesses, harness, binOf, agentName, splitArgs };
