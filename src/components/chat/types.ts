import type { ApprovalDecision, ChatItem, RevertResult } from '../../types';

export type ItemOf<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>;

export type ChatActions = {
  onForceSteer(id: string): void;
  onReload(): void;
  onUndo(doneId: string, runId: string): void;
  onReview(runId: string, path?: string): void;
  onMemory(id: string, action: 'save' | 'dismiss'): void;
  onRevertFile(runId: string, path: string, force?: boolean): Promise<RevertResult | null>;
  onOpenFile(path: string, line?: number): void;
  onCommit(runId: string): void;
  onCompare(runId: string, pair?: string): void;
  onPickVariant(itemId: string, runId: string): void;
  onApprove(itemId: string, decision: ApprovalDecision): void;
  onEditMessage(text: string): void;
  onSendText(text: string): void;
  onSaveSnippet(text: string): void;
  onRewind(itemId: string): void;
  onFork(itemId: string): void;
  onMeasureBuild(runId: string): void;
  onOpenLocal(): void;
  onFlowFix(runId: string): void;
  onVariantsLive(itemId: string): void;
};
