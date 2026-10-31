import { useState } from 'react';
import { MOD, api, readHistory } from '../shared';
import { AgentControls } from '../../components/agent/AgentControls';
import { AgentPicker } from '../../components/agent/AgentPicker';
import { ContextMeter, ReadingStrip } from '../../components/agent/AgentStatus';
import { AnnotationList, ImageChips } from '../../components/agent/AnnotationList';
import { ContextBar } from '../../components/agent/ContextBar';
import { GitPanel } from '../../components/git/GitPanel';
import { AlertTriangle, ArrowUp, CornerDownRight, DotsThree, FileText, Paperclip, Pencil, Square, SquareStack, X, Zap } from '../../components/ui/icons';
import { HandoffMenu, VariantsMenu } from '../../components/page/PageTools';
import { BackgroundRuns } from '../../components/page/Workbench';
import { toPlaywright } from '../../lib/handoff';
import { useDismiss } from '../../lib/hooks';
import type { AppContext } from '../context';

export function Composer({ app }: { app: AppContext }) {
  const settings = app.settings!;
  const [composerMore, setComposerMore] = useState(false);
  useDismiss(composerMore, () => setComposerMore(false), { ignore: '.composer-tray-wrap' });
  return (
    <div className={`composer ${composerMore ? 'more' : ''}`}>
      <BackgroundRuns
        runs={app.bgRuns} onApply={app.applyBg} onDiscard={app.discardBg}
        onDiff={(r) => api.bgDiff(r.id).then((text) => app.setPatchView({ title: r.title, text }))}
      />
      {app.projectDir && (
        <ContextBar
          lead={<>
            <GitPanel status={app.gitStatus} refresh={app.refreshGit} settings={settings} saveSettings={app.saveSettings} busy={!!app.runId} prDefaults={app.prDefaults} flash={app.flash} onOpenWorktree={app.openWorktree} onCompare={(base, remote) => app.setBranchCompare({ base, remote })} onSwitched={() => { if (/^file:/.test(app.nav.url)) app.browser.current?.reload(); }} />
          </>}
          route={app.currentRoute}
          console={app.consoleLog} network={app.netFails}
          includeDiag={app.includeDiag} setIncludeDiag={app.setIncludeDiag}
          onClearDiag={app.clearDiagnostics} onAskFix={app.askToFix}
          designSystem={app.designSystem}
          a11y={app.a11y} includeA11y={app.includeA11y} setIncludeA11y={app.setIncludeA11y} onAskA11y={app.askA11y}
          onShowNode={(sel) => app.browser.current?.reveal(sel)}
        />
      )}
      <AnnotationList
        annotations={app.annotations} root={app.root} activeId={app.activeId} overlayImage={app.overlay?.image ?? null} editingId={app.popover?.id ?? null}
        pageMarks={app.page.shapes.length} sketchMarks={app.sketch.shapes.length}
        onFocus={app.focusAnn} onActive={app.setActiveId} onNote={app.updateNote} onPaste={app.onPaste} onSend={() => app.send()}
        onCopyTest={(a) => { navigator.clipboard?.writeText(toPlaywright(a)); app.flash('Playwright test copied.'); }}
        onOverlay={(a) => app.setOverlay(app.overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false })}
        onRemove={app.removeAnn}
      />

      {app.limits && (
        <div className={`limit-banner ${app.limits.status}`}>
          <AlertTriangle size={13} />
          <span>
            {app.limits.status === 'rejected' ? 'Usage limit reached' : 'Close to your usage limit'}
            {app.limits.used != null ? ` · ${app.limits.used}% used` : ''}{app.limits.window ? ` (${app.limits.window})` : ''}
            {app.limits.resetsAt ? ` · resets ${new Date(app.limits.resetsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
          <button className="icon-btn xs" onClick={() => app.setLimits(null)} title="Dismiss"><X size={12} /></button>
        </div>
      )}
      {app.runId && <ReadingStrip items={app.chat} root={app.root} />}
      {app.queuedRef.current.length > 0 && (
        <div className="queue-tray">
          <div className="queue-title">Waiting to send when this run ends</div>
          {app.queuedRef.current.map((q) => (
            <div key={q.itemId} className="queue-item">
              <span>{q.request.instruction || `${q.request.annotations.length} annotation${q.request.annotations.length === 1 ? '' : 's'}`}</span>
              <button className="icon-btn xs" onClick={() => app.unqueue(q.itemId, true)} title="Take it back to edit"><Pencil size={12} /></button>
              <button className="icon-btn xs" onClick={() => app.unqueue(q.itemId, false)} title="Don't send it"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-box">
        {app.assist.popover}
        {app.pastes.length > 0 && (
          <div className="paste-chips">
            {app.pastes.map((p) => (
              <span key={p.id} className={`paste-chip ${app.pasteOpen === p.id ? 'on' : ''}`}>
                <button onClick={() => app.setPasteOpen(app.pasteOpen === p.id ? null : p.id)} title="Show what was pasted"><FileText size={12} /> Pasted text · {p.text.split('\n').length} lines</button>
                <button onClick={() => app.setPastes((list) => list.filter((x) => x.id !== p.id))} title="Remove"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <ImageChips
          annotations={app.annotations} overlayImage={app.overlay?.image ?? null} onActive={app.setActiveId} onRemove={app.removeAnn}
          onOverlay={(a) => app.setOverlay(app.overlay?.image === a.image ? null : { image: a.image!, name: a.name || 'mockup', opacity: 0.5, x: 0, y: 0, moving: false })}
        />
        {app.pasteOpen && <pre className="paste-preview">{app.pastes.find((p) => p.id === app.pasteOpen)?.text}</pre>}
        {app.planMode && !app.runId && <button className="plan-pill" onClick={() => app.setPlanMode(false)} title="The agent proposes changes without making them. Click to let it edit files.">Plan only ×</button>}
        <textarea
          ref={app.composerRef}
          value={app.instruction}
          onChange={(e) => { app.setInstruction(e.target.value); app.assist.track(); }}
          onSelect={app.assist.track}
          placeholder={app.runId
            ? `Steer the agent: Enter adds it after the current step · ${MOD}+Enter interrupts now`
            : app.annotations.length ? 'Anything else? (optional)' : app.chat.length ? 'Follow up' : 'Describe a change  ·  @ files  ·  / commands'}
          onKeyDown={(e) => {
            if (app.assist.onKeyDown(e)) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); app.setHistoryOpen(true); return; }
            if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
              // ↑ / ↓ walk through what you've sent, when the box is empty or you're already browsing it.
              const t = e.currentTarget;
              const browsing = app.historyAt.current >= 0;
              const atEdge = e.key === 'ArrowUp' ? t.selectionStart === 0 : t.selectionStart === t.value.length;
              if ((browsing || !t.value) && atEdge) {
                const list = readHistory();
                const next = e.key === 'ArrowUp' ? Math.min(list.length - 1, app.historyAt.current + 1) : app.historyAt.current - 1;
                if (next !== app.historyAt.current && (next >= 0 || browsing)) {
                  e.preventDefault();
                  app.historyAt.current = next;
                  app.setInstruction(next >= 0 ? list[next] : '');
                  return;
                }
              }
            }
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            app.send(app.runId && (e.ctrlKey || e.metaKey) ? 'now' : 'queue');
          }}
          onPaste={app.onPaste}
          rows={3}
        />
        <div className="composer-foot">
          <button className="icon-btn attach-btn" onClick={() => app.fileInput.current?.click()} title="Attach reference images (or paste / drop them)"><Paperclip size={15} /></button>
          {!app.runId && (
            <div className={`composer-tray-wrap ${composerMore ? 'open' : ''}`}>
              <button className={`icon-btn composer-more ${composerMore ? 'on' : ''}`} onClick={() => setComposerMore(!composerMore)} title="More: share, variants, run in the background"><DotsThree size={15} />{(app.reviewComments.length > 0 || (settings.variants || 0) > 1) && <i className="more-dot" />}</button>
              <div className="composer-tray">
                <HandoffMenu hasRequest={!!(app.instruction.trim() || app.annotations.length)} canIssue={!!app.gitStatus?.gh.authed && !!app.gitStatus?.remote} onExport={app.exportHandoff} onCopy={app.copyHandoff} onIssue={app.issueHandoff} onImport={app.importHandoff} onReview={() => app.setReviewOpen(true)} reviewCount={app.reviewComments.length} reviewing={app.reviewing} />
                <VariantsMenu value={settings.variants || 0} set={(n) => app.saveSettings({ variants: n })} />
                <button className="icon-btn bg-btn" disabled={!app.canSend || !!app.bgBlocked} onClick={() => { setComposerMore(false); app.send('bg'); }} title={app.bgBlocked || 'Run in the background: in a separate copy of the project, so you can keep working and send more'}><SquareStack size={15} /></button>
              </div>
            </div>
          )}
          <input ref={app.fileInput} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) app.addReferences(e.target.files); e.target.value = ''; }} />
          {app.runId
            ? <span className="steer-hint"><kbd>↵</kbd> after this step <kbd>{MOD}↵</kbd> now</span>
            : <>
              <AgentPicker
                value={settings.agent} harnesses={app.harnesses} agents={app.agents} disabled={!!app.runId} mcp={app.mcp}
                onPick={(agent) => app.saveSettings({ agent })} onSetup={() => app.setSettingsOpen(true)}
              />
              <AgentControls settings={settings} catalog={app.catalog} onChange={app.saveSettings} harness={app.harnesses.find((h) => h.id === settings.agent)} />
            </>}
          {app.usage && <ContextMeter used={app.usage.used} window={app.usage.window} />}
          {app.runId ? (
            <div className="run-actions">
              <button className="icon-btn stop-btn" onClick={app.cancel} title="Stop the agent"><Square size={11} weight="fill" /></button>
              <button className="btn sm ghost send-btn" disabled={!app.canSend} onClick={() => app.send('now')} title={`Interrupt the current step and send now (${MOD}+Enter)`}><Zap size={13} /><span className="btn-text">Now</span></button>
              <button className="btn primary sm send-btn" disabled={!app.canSend} onClick={() => app.send('queue')} title="Send after the agent's current step (Enter)"><CornerDownRight size={13} /><span className="btn-text">Steer</span></button>
            </div>
          ) : (
            <div className="run-actions">
              <button className="btn primary sm send-btn round" disabled={!app.canSend} onClick={() => app.send()} title="Send (Enter)"><ArrowUp size={15} /><span className="sr-only">Send</span></button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
