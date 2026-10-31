import { ShieldCheck } from '../../ui/icons';
import { shortPath } from '../../../lib/util';
import type { ChatActions, ItemOf } from '../types';

export function ApprovalItem({ item, root, actions }: { item: ItemOf<'approval'>; root: string; actions: ChatActions }) {
  const pending = item.status === 'pending';
  const said = { allow: 'Allowed once', always: 'Always allowed for this run', deny: 'Denied', expired: 'Not answered before the run ended', pending: '' }[item.status];
  return (
    <div className={`approval ${item.status}`}>
      <div className="approval-head"><ShieldCheck size={14} /><span><b>{item.tool}</b>{pending ? ' needs your OK' : ''}</span>{!pending && <span className="approval-said">{said}</span>}</div>
      {item.detail && <pre className="approval-detail">{shortPath(item.detail, root)}</pre>}
      {pending && (
        <div className="approval-actions">
          <button className="btn xs primary" onClick={() => actions.onApprove(item.id, 'allow')}>Allow once</button>
          <button className="btn xs" onClick={() => actions.onApprove(item.id, 'always')} title="Don't ask again for this during the run">Always</button>
          <div className="spacer" />
          <button className="btn xs ghost" onClick={() => actions.onApprove(item.id, 'deny')}>Deny</button>
        </div>
      )}
    </div>
  );
}
