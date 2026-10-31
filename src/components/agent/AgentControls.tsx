import { Eye, Pencil, ShieldCheck, Zap } from '../ui/icons';
import { Dropdown, type DropdownItem } from '../ui/Dropdown';
import { ModelPicker } from './ModelPicker';
import type { HarnessInfo, ModelCatalog, Settings } from '../../types';

const EFFORT_INFO: Record<string, { label: string; desc: string }> = {
  minimal: { label: 'Minimal', desc: 'Almost no reasoning' },
  low: { label: 'Low', desc: 'Quick: copy tweaks, colors, spacing' },
  medium: { label: 'Medium', desc: 'Balanced speed and care' },
  high: { label: 'High', desc: 'Deeper reasoning for layout work' },
  xhigh: { label: 'Extra high', desc: 'Very thorough; best for tricky changes' },
  max: { label: 'Max', desc: 'Maximum reasoning; slowest' },
};

const ACCESS = {
  claude: [
    { value: 'plan', label: 'Plan only', desc: 'Proposes a plan; no files are changed' },
    { value: 'acceptEdits', label: 'Edit files', desc: 'Auto-accepts file edits in the project' },
    { value: 'bypassPermissions', label: 'Full access', desc: 'Edits files and runs any command' },
  ],
  codex: [
    { value: 'read-only', label: 'Plan only', desc: 'Read-only sandbox; no files are changed' },
    { value: 'workspace-write', label: 'Edit files', desc: 'Can write inside the project folder' },
    { value: 'danger-full-access', label: 'Full access', desc: 'No sandbox; runs any command' },
  ],
} as const;

interface Props {
  settings: Settings;
  catalog: ModelCatalog | null;
  onChange(patch: Partial<Settings>): void;
  disabled?: boolean;
  harness?: HarnessInfo;
}

// Each access level has its own icon, so the composer needs no words for it.
function accessIcon(label = '', size = 13) {
  if (/plan/i.test(label)) return <Eye size={size} />;
  if (/full/i.test(label)) return <Zap size={size} />;
  if (/edit/i.test(label)) return <Pencil size={size} />;
  return <ShieldCheck size={size} />;
}
const withIcons = (items: readonly { value: string; label: string; desc?: string }[]) => items.map((i) => ({ ...i, icon: accessIcon(i.label, 15) }));
const accessProps = (items: readonly { value: string; label: string }[], value: string) => {
  const label = items.find((i) => i.value === value)?.label || '';
  return { icon: accessIcon(label), tooltip: `Access: ${label}`, className: `dd-access ${/full/i.test(label) ? 'access-full' : ''}` };
};

export function AgentControls({ settings, catalog, onChange, disabled, harness }: Props) {
  const agent = settings.agent;
  if (agent !== 'claude' && agent !== 'codex') {
    const access = harness?.access || [];
    const model = settings.agentModels?.[agent];
    return (
      <div className="agent-controls">
        {model && <span className="harness-model" title="Model (change it in Settings)">{model}</span>}
        {access.length > 0 && (
          <Dropdown
            {...accessProps(access, settings.agentAccess?.[agent] || harness?.defaultAccess || access[0].value)}
            title="Access"
            value={settings.agentAccess?.[agent] || harness?.defaultAccess || access[0].value}
            items={withIcons(access)}
            onChange={(v) => onChange({ agentAccess: { ...settings.agentAccess, [agent]: v } })}
            disabled={disabled}
            align="right"
          />
        )}
      </div>
    );
  }
  const cat = catalog?.[agent];
  const modelKey = agent === 'claude' ? 'claudeModel' : 'codexModel';
  const effortKey = agent === 'claude' ? 'claudeEffort' : 'codexEffort';
  const model = settings[modelKey];
  const effort = settings[effortKey];

  const models = cat?.models || [];
  const selectedModel = models.find((m) => m.id === model);
  const effectiveModel = selectedModel || models.find((m) => m.id === cat?.defaultModel) || models[0];
  const efforts = effectiveModel?.efforts ?? [];

  const modelItems: DropdownItem[] = [
    { value: '', label: 'Default', desc: cat?.defaultLabel },
    ...models.map((m) => ({ value: m.id, label: m.label, desc: m.desc })),
  ];
  if (model && !selectedModel) modelItems.push({ value: model, label: model, desc: 'Custom model' });

  const defaultEffort = cat?.defaultEffort || effectiveModel?.defaultEffort;
  const levels = efforts.map((e) => ({ value: e, label: EFFORT_INFO[e]?.label || e, desc: EFFORT_INFO[e]?.desc }));

  const accessKey = agent === 'claude' ? 'claudePermission' : 'codexSandbox';
  const access = settings[accessKey];

  const setModel = (id: string) => {
    const next = models.find((m) => m.id === id) || (id ? undefined : effectiveModel);
    const patch: Partial<Settings> = { [modelKey]: id };
    if (effort && next && !next.efforts.includes(effort)) patch[effortKey] = '';
    onChange(patch);
  };

  return (
    <div className="agent-controls">
      <ModelPicker
        model={model}
        models={modelItems}
        modelLabel={model ? (selectedModel?.label || model) : (models.find((m) => m.id === cat?.defaultModel)?.label || 'Default')}
        onModel={setModel}
        level={efforts.includes(effort) ? effort : ''}
        levels={levels}
        defaultLevel={defaultEffort && efforts.includes(defaultEffort) ? defaultEffort : undefined}
        onLevel={(v) => onChange({ [effortKey]: v })}
        disabled={disabled}
      />
      <Dropdown
        {...accessProps(ACCESS[agent as keyof typeof ACCESS], access)}
        title="Access"
        value={access}
        items={withIcons(ACCESS[agent as keyof typeof ACCESS])}
        onChange={(v) => onChange({ [accessKey]: v } as Partial<Settings>)}
        disabled={disabled}
        align="right"
      />
    </div>
  );
}
