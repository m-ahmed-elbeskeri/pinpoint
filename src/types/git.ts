import type { DiffFile } from './chat';

export interface GitCommit { hash: string; subject: string }
export interface GitStatus {
  repo: boolean; root?: string; branch?: string; defaultBranch?: string; remote?: string | null; hasCommits?: boolean;
  dirty?: number; ahead?: number; behind?: number; upstream?: boolean; linked?: boolean;
  upstreamName?: string | null; gone?: boolean; fetchedAt?: number;
  gh: { installed: boolean; authed: boolean; user: string | null; checking?: boolean };
}

export interface GitBranchInfo {
  name: string; remote: boolean; subject: string; when: number; current: boolean;
  ahead: number; behind: number; gone: boolean; worktree: string | null; parked: number;
}
export interface GitPull { number: number; state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED'; url: string; title: string }
export interface BranchCompare {
  sub: string; branch: string; base: string; ref: string; mergeBase: string; working: boolean; total: number; behind: number;
  files: CompareFile[];
  incomingFiles: CompareFile[];
  commits: GitLogEntry[];
  incoming: GitLogEntry[];
  conflicts: string[] | null;
  remote: boolean;
}
export type CompareFile = DiffFile & { from?: string; untracked?: boolean };
export interface GitLogEntry { hash: string; subject: string; author: string; when: number }
