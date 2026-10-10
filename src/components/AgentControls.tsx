import { ShieldCheck } from './icons';
import { Dropdown, type DropdownItem } from './Dropdown';
import { ModelPicker } from './ModelPicker';
import type { ModelCatalog, Settings } from '../lib/types';

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
}

// Model + thinking level (one control) and access pickers for the selected agent.
export function AgentControls({ settings, catalog, onChange, disabled }: Props) {
  const agent = settings.agent;
  const cat = catalog?.[agent];
  const modelKey = agent === 'claude' ? 'claudeModel' : 'codexModel';
  const effortKey = agent === 'claude' ? 'claudeEffort' : 'codexEffort';
  const model = settings[modelKey];
  const effort = settings[effortKey];

  const models = cat?.models || [];
  const selectedModel = models.find((m) => m.id === model);
  // With no explicit model, show the efforts of the model the CLI will use by default.
  const effectiveModel = selectedModel || models.find((m) => m.id === cat?.defaultModel) || models[0];
  const efforts = effectiveModel?.efforts ?? [];

  const modelItems: DropdownItem[] = [
    { value: '', label: 'Default', desc: cat?.defaultLabel },
    ...models.map((m) => ({ value: m.id, label: m.label, desc: m.desc })),
  ];
  // A model typed in older settings that isn't in the catalog still shows up.
  if (model && !selectedModel) modelItems.push({ value: model, label: model, desc: 'Custom model' });

  const defaultEffort = cat?.defaultEffort || effectiveModel?.defaultEffort;
  const levels = efforts.map((e) => ({ value: e, label: EFFORT_INFO[e]?.label || e, desc: EFFORT_INFO[e]?.desc }));

  const accessKey = agent === 'claude' ? 'claudePermission' : 'codexSandbox';
  const access = settings[accessKey];

  const setModel = (id: string) => {
    const next = models.find((m) => m.id === id) || (id ? undefined : effectiveModel);
    const patch: Partial<Settings> = { [modelKey]: id };
    // Drop a thinking level the new model doesn't support.
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
        className="dd-access"
        icon={<ShieldCheck size={12} />}
        title="Access"
        value={access}
        items={[...ACCESS[agent]]}
        onChange={(v) => onChange({ [accessKey]: v } as Partial<Settings>)}
        disabled={disabled}
        align="right"
      />
    </div>
  );
}
