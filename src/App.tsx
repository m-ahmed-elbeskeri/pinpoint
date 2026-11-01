import { useRef } from 'react';
import { MOD, api, combo } from './app/shared';
import { ChatPanel } from './app/views/ChatPanel';
import { Overlays } from './app/views/Overlays';
import { PageBar } from './app/views/PageBar';
import { PageFrame } from './app/views/PageFrame';
import { ToolView } from './app/views/ToolView';
import { ChatHistory } from './components/shell/ChatHistory';
import { CornerDownRight, Loader2, MessageSquare, SquarePen } from './components/ui/icons';
import { ThreadSidebar } from './components/shell/ThreadSidebar';
import { TopBar } from './components/shell/TopBar';
import { chatTitle, needsInput } from './lib/chat';
import { useSettings } from './app/useSettings';
import { useTabs } from './app/useTabs';
import { useLayout } from './app/useLayout';
import { useDevServer } from './app/useDevServer';
import { useNetwork } from './app/useNetwork';
import { useProjectContext } from './app/useProjectContext';
import { useGit } from './app/useGit';
import { usePage } from './app/usePage';
import { useSite } from './app/useSite';
import { useChats } from './app/useChats';
import { useAnnotations } from './app/useAnnotations';
import { useComposer } from './app/useComposer';
import { useFlows } from './app/useFlows';
import { useRuns } from './app/useRuns';
import { useAgentEvents } from './app/useAgentEvents';
import { useVariantsAndMockups } from './app/useVariantsAndMockups';
import { useReviewAndSweep } from './app/useReviewAndSweep';
import { useHandoff } from './app/useHandoff';
import { useBackgroundRuns } from './app/useBackgroundRuns';
import { useSideChats } from './app/useSideChats';
import { useCommands } from './app/useCommands';
import { useShortcuts } from './app/useShortcuts';
import { useAppStatus } from './app/useAppStatus';
import type { AppContext } from './app/context';

export default function App() {
  const app = useRef({} as AppContext).current;
  useSettings(app);
  useTabs(app);
  useLayout(app);
  useDevServer(app);
  useNetwork(app);
  useProjectContext(app);
  useGit(app);
  usePage(app);
  useSite(app);
  useChats(app);
  useAnnotations(app);
  useComposer(app);
  useFlows(app);
  useRuns(app);
  useAgentEvents(app);
  useVariantsAndMockups(app);
  useReviewAndSweep(app);
  useHandoff(app);
  useBackgroundRuns(app);
  useSideChats(app);
  useCommands(app);
  useShortcuts(app);
  useAppStatus(app);

  const settings = app.settings;
  if (!settings) return <div className="boot"><Loader2 className="spin" /></div>;

  return (
    <div className={`app ${app.resizing ? 'resizing' : ''} ${app.threadsOn ? 'threads-on' : ''} ${app.zen ? 'zen' : ''}`} style={app.gridStyle}>
      {app.threadsOn && (
        <ThreadSidebar
          subChats={[
            ...app.sides.map((x) => ({ id: x.id, kind: 'side' as const, title: x.title, parent: x.parent, running: x.running, on: app.activeSide === x.id, hint: x.running ? 'working' : 'side' })),
            ...app.bgRuns.map((r) => ({ id: r.id, kind: 'task' as const, title: r.title, parent: r.parent, running: r.status === 'running', failed: r.status === 'failed', on: app.activeSide === `bg:${r.id}`, hint: r.status === 'running' ? 'working' : r.status === 'failed' ? 'stopped' : r.files?.length ? `${r.files.length} file${r.files.length === 1 ? '' : 's'}` : 'done' })),
          ]}
          onOpenSub={(s) => { if (s.kind === 'task') app.openBg(s.id); else { app.setActiveSide(s.id); if (settings.panelHidden) app.saveSettings({ panelHidden: false }); } }}
          mod={MOD} projectDir={app.projectDir} recentProjects={settings.recentProjects || []}
          chatId={app.chatId} currentTitle={app.chat.length ? chatTitle(app.chat) : ''} currentRunning={!!app.runId} currentNeedsInput={needsInput(app.chat)}
          others={app.others} pulls={app.pulls} refreshKey={`${app.chatId}:${app.chat.length}:${app.others.map((o) => o.id + o.running).join()}`} disabled={!!app.job}
          onOpen={app.openChat} onDelete={app.deleteChat} onNew={app.newChat} onPickProject={app.pickProject}
          onOpenIn={(dir, id) => { app.wantChat.current = id; app.pickProject(dir); }}
          onSettings={() => app.setSettingsOpen(true)} onPalette={() => app.setPaletteOpen(true)} onHide={app.toggleThreads}
          onTheme={() => app.saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' })} onShortcuts={() => app.setShortcutsOpen(true)} onTerminal={() => app.openTool('term')} light={app.theme === 'light' || (app.theme === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches)}
        />
      )}
      <TopBar
        threadsHidden={!app.threadsOn} onToggleThreads={app.toggleThreads} onPalette={() => app.setPaletteOpen(true)}
        chatTools={!app.threadsOn && app.projectDir ? (
          <>
            <button className="icon-btn" onClick={app.newChat} disabled={!!app.job || !app.chat.length} title={`New chat (${combo('O', true)})`}><SquarePen size={16} /></button>
            <ChatHistory currentId={app.chatId} disabled={!!app.job} others={app.others} onOpen={app.openChat} onDelete={app.deleteChat} />
          </>
        ) : null}
        mod={MOD} projectDir={settings.projectDir} onPickProject={() => app.pickProject()}
        mode={app.mode} setMode={app.setMode}
        recording={!!app.rec} canRecord={/^(https?|file):/.test(app.nav.url)} onToggleRecording={app.toggleRecording}
        update={app.update} onInstallUpdate={() => api.updateInstall()}
        sheet={app.sheet} setSheet={app.setSheet}
        design={app.design?.exists ? (settings.useDesign ? 'on' : 'off') : 'none'} designChanged={app.designChanged} memoryOn={app.memoryOn}
        onDevtools={() => app.browser.current?.devtools()}
        panelSide={app.left ? 'left' : 'right'} panelHidden={!!settings.panelHidden} onTogglePanel={app.togglePanel}
        onSettings={() => app.setSettingsOpen(true)}
      />

      <main className={`stage ${app.split ? 'split' : ''}`}>
        <PageBar app={app} />
        <PageFrame app={app} />
        <ToolView app={app} />
      </main>
      {app.askAside && (
        <div className="ask-aside" style={{ left: app.askAside.x, top: app.askAside.y }} onMouseDown={(e) => e.preventDefault()}>
          <button onClick={() => app.fromSelection('side')} title="Start a side chat about this"><MessageSquare size={12} /> Side chat</button>
          <button onClick={() => app.fromSelection('reply')} title="Quote this in your next message"><CornerDownRight size={12} /> Reply</button>
        </div>
      )}

      <ChatPanel app={app} />

      <Overlays app={app} />
    </div>
  );
}
