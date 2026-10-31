import { MOD } from '../shared';
import { ElementTools } from '../../components/page/ElementTools';
import { Trash2, X, Zap } from '../../components/ui/icons';
import { describe } from '../../lib/handoff';
import type { AppContext } from '../context';

export function NotePopover({ app }: { app: AppContext }) {
  const { popAnn, popover } = app;
  if (!popover || !popAnn || app.mode === 'draw' || app.mode === 'sketch') return null;
  return (
    <div className="note-pop" style={app.popoverStyle}>
      <div className="note-pop-head">
        <span className="badge" style={{ background: popAnn.color }}>{popAnn.n}</span>
        <span className="note-pop-title">{describe(popAnn, app.root).title}</span>
        <button className="icon-btn xs" onClick={() => app.setPopover(null)}><X size={13} /></button>
      </div>
      <textarea
        autoFocus
        placeholder="What should change here? (Enter to save)"
        value={popAnn.note}
        onChange={(e) => app.updateNote(popAnn.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !(e.ctrlKey || e.metaKey)) { e.preventDefault(); app.setPopover(null); }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); app.setPopover(null); app.send(); }
          if (e.key === 'Escape') app.setPopover(null);
        }}
      />
      {popAnn.kind === 'element' && popAnn.element && (
        <ElementTools
          key={popAnn.id} ann={popAnn} section={app.toolSection} setSection={app.setToolSection}
          classNames={app.classNames} generated={app.generated} isolated={app.isolated === popAnn.id}
          onStates={(s) => app.setStates(popAnn.id, s)}
          onScope={(scope) => app.patchAnn(popAnn.id, (a) => ({ ...a, scope }))}
          onTweak={(prop, value) => app.tweak(popAnn.id, prop, value)}
          onResetTweaks={() => app.resetTweaks(popAnn.id)}
          onText={(t) => app.editText(popAnn.id, t)}
          onClasses={(v) => app.editClasses(popAnn.id, v)}
          onProp={(name, v) => app.editProp(popAnn.id, name, v)}
          onIsolate={(on) => app.isolate(on ? popAnn.id : null)}
          onStory={() => app.openStory(popAnn.id)}
          onOpenFile={app.openFile}
        />
      )}
      <div className="note-pop-foot">
        <button className="btn ghost xs" onClick={() => app.removeAnn(popAnn.id)}><Trash2 size={12} /> Remove</button>
        {app.plan
          ? <button className="btn xs primary" disabled={!app.plan.ok} onClick={() => app.applyInstant(popAnn.id)} title={app.plan.ok ? `Write it straight into the source, no agent:\n${app.plan.summary?.join('\n')}` : `Can't be written directly: ${app.plan.reason}\nSend it and the agent will do it.`}><Zap size={12} /> Apply now</button>
          : <span className="hint">Enter to save · {MOD}+Enter to send</span>}
      </div>
      {app.plan && !app.plan.ok && <p className="hint plan-why">Needs the agent: {app.plan.reason}</p>}
    </div>
  );
}
