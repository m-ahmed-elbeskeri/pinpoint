import { BranchCompare, CompareView, ContextSheet, LayoutsSheet, ReviewPanel, SettingsModal, SweepView, Timeline, VariantsLive } from '../panels';
import { api, readHistory, spentToday } from '../shared';
import { CommandPalette } from '../../components/shell/CommandPalette';
import { X } from '../../components/ui/icons';
import { ShortcutsSheet, StatusBar } from '../../components/shell/StatusBar';
import { EnginesView } from '../../components/page/Workbench';
import { partitionOf } from '../../lib/urls';
import type { AppContext } from '../context';

export function Overlays({ app }: { app: AppContext }) {
  const settings = app.settings!;
  return (
    <>
      {app.resizing && <div className={`drag-shield ${app.resizing}`} />}

      {app.sheet && (
        <ContextSheet
          tab={app.sheet} setTab={app.setSheet} onClose={() => app.setSheet(null)}
          settings={settings} saveSettings={app.saveSettings}
          design={app.design} setDesign={app.setDesign}
          memory={app.memory} setMemory={app.setMemory}
          canExtract={/^(https?|file):/.test(app.nav.url)}
          extract={() => app.browser.current?.extractDesign() ?? Promise.resolve(null)}
          askAgent={app.askAgentForDesign}
          root={app.root}
          designChanged={app.designChanged}
          onNewChat={() => { app.newChat(); app.setSheet(null); app.flash('New chat: the next request sends the updated design rules.'); }}
          chatBusy={!!app.runId}
        />
      )}
      {app.enginesOpen && (
        <EnginesView
          url={app.nav.url}
          capture={app.cleanCapture}
          shoot={() => api.enginesShoot({ webContentsId: app.browser.current!.id()!, url: app.nav.url, ...app.browser.current!.size() })}
          onCompare={(images, labels, title) => app.setCompare({ images, labels, title })}
          onClose={() => app.setEnginesOpen(false)}
        />
      )}
      {app.sweepOpen && (
        <SweepView
          {...app.sweepPlan()} partition={partitionOf(app.tab?.profile || '')}
          onOpen={app.sweepOpenPage} onFix={app.sweepFix} onClose={() => app.setSweepOpen(false)}
        />
      )}
      {app.liveItem && (
        <VariantsLive
          options={app.liveItem.options} chosen={app.liveItem.chosen} page={app.livePage} busy={!!app.runId || !!app.job}
          onPick={(id) => { app.setLiveVariants(null); app.pickVariant(app.liveItem!.id, id); }}
          onClose={() => app.setLiveVariants(null)}
        />
      )}
      {app.reviewOpen && (
        <ReviewPanel
          url={app.nav.url} canShare={app.kind === 'dev' || app.kind === 'built'}
          whyNot={app.kind === 'live' ? 'This is the live site: send people its normal address. Open the page locally to share your working copy.' : 'Open a page from your dev server first.'}
          comments={app.reviewComments} onAdd={app.addReviewComments}
          onDismiss={(id) => app.setReviewComments((cs) => cs.filter((c) => c.id !== id))}
          onState={(s) => app.setReviewing(s.running)} flash={app.flash} onClose={() => app.setReviewOpen(false)}
        />
      )}
      {app.patchView && (
        <div className="modal-backdrop" onMouseDown={() => app.setPatchView(null)}>
          <div className="compare-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="diff-head"><h3>{app.patchView.title}</h3><div className="spacer" /><button className="icon-btn" onClick={() => app.setPatchView(null)}><X size={16} /></button></div>
            <pre className="patch-view">{app.patchView.text.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : l.startsWith('@@') || l.startsWith('diff ') ? 'meta' : ''}>{l + '\n'}</span>)}</pre>
          </div>
        </div>
      )}
      {app.compare && <CompareView {...app.compare} onClose={() => app.setCompare(null)} captureSizes={app.captureSizes} />}
      {app.branchCompare && app.gitStatus?.repo && (
        <BranchCompare status={app.gitStatus} initialBase={app.branchCompare.base} initialRemote={app.branchCompare.remote} initialPr={app.branchCompare.pr} prDefaults={app.prDefaults} flash={app.flash} onOpen={app.openFile} onClose={() => { app.setBranchCompare(null); app.refreshGit(); }} />
      )}
      {app.settingsOpen && <SettingsModal settings={settings} agents={app.agents} harnesses={app.harnesses} onSave={app.saveSettings} onClose={() => app.setSettingsOpen(false)} />}
      {app.statusOn && (
        <StatusBar
          branch={app.gitStatus?.repo ? app.gitStatus.branch : undefined} dirty={app.gitStatus?.dirty}
          devRunning={app.devRunning} devCommand={app.devCommand}
          errors={app.consoleLog.filter((c) => c.level === 'error').length}
          agent={app.agentName} model={app.modelName || ''} cost={app.chatCost} today={spentToday()}
          // The git panel keeps its own open state; its chip in the composer is the way in.
          onBranch={() => (document.querySelector('.composer .git-wrap > .chip') as HTMLElement | null)?.click()}
          onDev={() => { app.setDrawerOpen(true); app.setDrawerTab('dev'); }}
          onErrors={() => app.browser.current?.devtools()}
        />
      )}
      {app.historyOpen && (
        <CommandPalette
          placeholder="Search what you've sent…"
          commands={readHistory().map((t, i) => ({ id: `h${i}`, group: 'Sent before', label: t.split('\n')[0].slice(0, 120), hint: t.includes('\n') ? `${t.split('\n').length} lines` : undefined, run: () => { app.setInstruction(t); app.focusComposer(); } }))}
          onClose={() => app.setHistoryOpen(false)}
        />
      )}
      {app.timelineOpen && <Timeline items={app.chat} onClose={() => app.setTimelineOpen(false)} onCompare={(images, labels, title) => { app.setTimelineOpen(false); app.setCompare({ images, labels, title }); }} />}
      {app.shortcutsOpen && <ShortcutsSheet onClose={() => app.setShortcutsOpen(false)} />}
      {app.layoutsOpen && <LayoutsSheet layouts={settings.layouts || []} onSave={app.saveLayout} onApply={(l) => { app.applyLayout(l); app.setLayoutsOpen(false); }} onRemove={(name) => app.saveSettings({ layouts: (settings.layouts || []).filter((x) => x.name !== name) })} onClose={() => app.setLayoutsOpen(false)} />}
      {app.paletteOpen && <CommandPalette commands={app.commands} onQuery={app.searchChats} onClose={() => { app.setPaletteOpen(false); app.setPaletteHits([]); }} />}
      {app.toast && <div className="toast">{app.toast}</div>}
    </>
  );
}
