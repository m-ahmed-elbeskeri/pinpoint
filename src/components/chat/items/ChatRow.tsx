import { memo } from 'react';
import type { ChatItem } from '../../../types';
import { ToolRow } from '../ToolRow';
import type { ChatActions } from '../types';
import { ApprovalItem } from './ApprovalItem';
import { DoneItem } from './DoneItem';
import { ErrorItem } from './ErrorItem';
import { MemoryItem } from './MemoryItem';
import { PlanItem } from './PlanItem';
import { StatusItem } from './StatusItem';
import { TextItem } from './TextItem';
import { ThinkingItem } from './ThinkingItem';
import { UserItem } from './UserItem';
import { VariantsItem } from './VariantsItem';

interface Props {
  item: ChatItem;
  live?: boolean;
  root: string;
  busy: boolean;
  gitRepo: boolean;
  actions: ChatActions;
}

function ChatItemView({ item, live, root, busy, gitRepo, actions }: Props) {
  switch (item.kind) {
    case 'user': return <UserItem item={item} live={live} busy={busy} actions={actions} />;
    case 'text': return <TextItem item={item} />;
    case 'thinking': return <ThinkingItem text={item.text} streaming={item.streaming} ms={item.ms} />;
    case 'tool': return <ToolRow item={item} root={root} />;
    case 'plan': return <PlanItem item={item} live={!!live} />;
    case 'approval': return <ApprovalItem item={item} root={root} actions={actions} />;
    case 'status': return <StatusItem item={item} />;
    case 'error': return <ErrorItem item={item} busy={busy} actions={actions} />;
    case 'memory': return <MemoryItem item={item} actions={actions} />;
    case 'variants': return <VariantsItem item={item} busy={busy} actions={actions} />;
    case 'done': return <DoneItem item={item} busy={busy} gitRepo={gitRepo} actions={actions} />;
  }
}

// `actions` is a stable object (useStableActions), so a row only re-renders when its own item or flags change.
export const ChatRow = memo(ChatItemView);
