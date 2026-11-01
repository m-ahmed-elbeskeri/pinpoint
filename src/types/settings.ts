import type { AgentId, CustomAgent } from './agent';

export interface UpdateState { status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; percent?: number; url?: string; manual?: boolean }

export interface SavedLayout { name: string; threadsHidden: boolean; panelHidden: boolean; panelSide: 'left' | 'right'; panelWidth: number; statusBar: boolean; split: boolean }
export interface DesignDoc { path: string; exists: boolean; content: string }

export interface Settings {
  // What's switched on or off per agent, by MCP server or skill.
  extensions?: Record<string, { mcp?: Record<string, boolean>; skills?: Record<string, boolean> }>;
  agent: AgentId;
  claudePath: string;
  codexPath: string;
  agentPaths?: Record<string, string>;
  agentModels?: Record<string, string>;
  agentAccess?: Record<string, string>;
  customAgents?: CustomAgent[];
  claudePermission: 'plan' | 'acceptEdits' | 'bypassPermissions';
  codexSandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  claudeModel: string;
  claudeEffort: string;
  codexModel: string;
  codexEffort: string;
  projectDir: string;
  url: string;
  devCommand: string;
  recentProjects: string[];
  panelSide: 'left' | 'right';
  panelWidth: number;
  terminalShell?: string;
  serverLog?: string;
  panelHidden: boolean;
  threadsHidden?: boolean;
  theme?: 'system' | 'dark' | 'light';
  statusBar?: boolean;
  tray?: boolean;
  split?: boolean;
  layouts?: SavedLayout[];
  onboarded?: boolean;
  snippets?: { name: string; text: string }[];
  sounds?: boolean;
  textSize?: 'small' | 'normal' | 'large';
  density?: 'compact' | 'comfortable';
  drawerHeight: number;
  useDesign: boolean;
  useMemory: boolean;
  editorCommand: string;
  gitBranchPerChat: boolean;
  gitAutoCommit: boolean;
  tabs?: string[];
  tabProfiles?: string[];
  activeTab?: number;
  autoVerify: boolean;
  variants: number;
  routeCheck: boolean;
  a11yCheck: boolean;
  perfCheck: boolean;
  layoutOverlay: boolean;
  liveUrl?: string;
}
