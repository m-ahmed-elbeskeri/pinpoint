export type Mode = 'browse' | 'select' | 'draw' | 'sketch';
export type Tool = 'pen' | 'highlighter' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser';

export interface Shape {
  id: string;
  tool: Exclude<Tool, 'eraser'>;
  color: string;
  size: number;
  points: [number, number][];
  text?: string;
}

export interface SourceInfo {
  file?: string;
  line?: number;
  column?: number;
  components?: string[];
  framework?: string;
  frame?: { url: string; line: number; column: number };
  owner?: string;
  props?: Record<string, string>;
}

interface ComponentInfo { name: string; props?: Record<string, string>; uses?: number; fileCount?: number; files?: string[] }

export type ForcedState = 'hover' | 'focus' | 'focus-visible' | 'active' | 'disabled';

export interface PageEnv { colorScheme: 'light' | 'dark' | null; reducedMotion: boolean }

export interface A11yIssue {
  id: string; impact: string | null; help: string; count: number;
  nodes: { target: string; html: string; summary: string }[];
}

export interface DesignSystem {
  tailwind: { version: string | null; config: string | null; entry?: string | null; configFile?: string | null } | null;
  libraries: string[];
  styling: string[];
  componentsConfig: string | null;
  tokenFiles: { file: string; count: number }[];
  tokens: { name: string; value: string }[];
}

export interface CssRuleInfo {
  selector: string; media?: string; file?: string; line?: number;
  approx?: boolean;
  utility?: boolean;
  declarations: { name: string; value: string; important: boolean }[];
  wins: string[];
}

export interface FlowStep { type: 'click' | 'fill' | 'check' | 'key' | 'navigate'; selector?: string; tag?: string; text?: string; value?: string; key?: string; url?: string; secret?: boolean }

export interface FlowResult { done: number; total: number; errors: string[]; failed: string[]; before?: { errors: number; failed: number } }

export interface ReviewComment {
  id: string; at: number; name: string; text: string; path: string; viewport: { width: number; height: number };
  selector?: string; tag?: string; classes?: string[]; elText?: string; html?: string; rect?: Rect;
}
export interface ReviewState { running: boolean; target?: string; port?: number; urls: string[]; comments: ReviewComment[] }

export interface SweepIssue { type: 'overflow' | 'image' | 'text' | 'tap' | 'a11y' | 'console' | 'request' | 'load'; text: string; nodes?: string[] }
interface SweepShot { size: 'phone' | 'tablet' | 'desktop'; label: string; width: number; thumb?: string; issues: SweepIssue[] }
export interface SweepPage { route: string; url: string; key: string; title?: string; shots: SweepShot[] }
export type SweepEvent =
  | { type: 'start'; total: number; pages: SweepPage[] }
  | { type: 'page'; total: number; page: SweepPage }
  | { type: 'shot'; done: number; total: number; key: string; title?: string; shot: SweepShot }
  | { type: 'done'; stopped: boolean; error?: string };

export interface PerfMetrics { js: number; css: number; requests: number; nodes: number; lcp: number; cls: number }

export interface BuildSize { js: number; css: number; jsGzip: number; cssGzip: number; files: number; at: number }

export interface Pin { id: string; url: string; label: string; pinnedAt: number; checkedAt?: number; pct?: number; changed?: boolean; error?: string; areas?: string[] }

export interface ComponentProp { name: string; required: boolean; type: 'string' | 'number' | 'boolean' | 'enum' | 'node' | 'other'; options?: string[]; default?: string | number | boolean }
export interface ComponentEntry { name: string; file: string; isDefault: boolean; props: ComponentProp[] }

export interface Profile { id: string; name: string; locale?: string; timezone?: string; flags?: string; headers?: string }

export type NetworkMode = 'normal' | 'slow' | 'hang' | 'error' | 'offline';

export interface Rect { x: number; y: number; width: number; height: number }

export interface ElementInfo {
  uid: string;
  selector: string;
  tag: string;
  id?: string;
  classes?: string[];
  text: string;
  html?: string;
  styles?: Record<string, string>;
  path?: string;
  rect: Rect;
  source?: SourceInfo | null;
  tokens?: Record<string, string>;
  component?: ComponentInfo | null;
  rules?: CssRuleInfo[];
  leaf?: boolean;
}

export interface RouteInfo { route: string; file: string; framework: string; dynamic: boolean }

export interface ConsoleEntry { level: 'error' | 'warning'; message: string; source?: string; line?: number; count: number; at: number; file?: string; fileLine?: number }
export interface NetworkFailure { url: string; method: string; status?: number; error?: string; resourceType?: string; at: number; body?: string; handler?: string }
export interface ApiHandler { file: string; line: number; pattern: string; methods: string[]; sure: boolean }
export interface NetRequest {
  id: string; kind: 'fetch' | 'xhr'; method: string; url: string; at: number; ms?: number;
  status?: number; type?: string; error?: string; reqBody?: string; resBody?: string;
}
export interface RequestNote {
  method: string; url: string; status?: number; ms?: number; error?: string;
  reqBody?: string; resBody?: string; handler?: { file: string; line: number; sure: boolean };
}
export interface Mock { id: string; method: string; path: string; status: number; body: string; on: boolean }
