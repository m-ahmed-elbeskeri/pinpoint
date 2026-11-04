import { useMemo, useRef } from 'react';
import { MOD, api, combo } from './app/shared';
import { ChatPanel } from './app/views/ChatPanel';
import { Overlays } from './app/views/Overlays';
import { PageBar } from './app/views/PageBar';
import { PageFrame } from './app/views/PageFrame';
import { ToolView } from './app/views/ToolView';
import { ChatHistory } from './components/shell/ChatHistory';
import { CornerDownRight, Loader2, MessageSquare, SquarePen } from './components/ui/icons';
import { ThreadSidebar, type SubChat } from './components/shell/ThreadSidebar';
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
import { useMcpBridge } from './app/useMcpBridge';
import { useCommands } from './app/useCommands';
import { useShortcuts } from './app/useShortcuts';
import { useAppStatus } from './app/useAppStatus';
import type { AppContext } from './app/context';
import type { Mode } from './types';
import { usePrefersLight, useStableActions } from './lib/hooks';

const NONE: string[] = [];

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
  useMcpBridge(app);
  useCommands(app);
  useShortcuts(app);
  useAppStatus(app);

  const settings = app.settings;
  // The sidebar and top bar are memoised; these keep their props the same object between renders,
  // so a streaming chat doesn't re-render them on every token.
  const subChats = useMemo<SubChat[]>(() => [
    ...app.sides.map((x) => ({ id: x.id, kind: 'side' as const, title: x.title, parent: x.parent, running: x.running, on: app.activeSide === x.id, hint: x.running ? 'working' : 'side' })),
    ...app.bgRuns.map((r) => ({ id: r.id, kind: 'task' as const, title: r.title, parent: r.parent, running: r.status === 'running', failed: r.status === 'failed', on: app.activeSide === `bg:${r.id}`, hint: r.status === 'running' ? 'working' : r.status === 'failed' ? 'stopped' : r.files?.length ? `${r.files.length} file${r.files.length === 1 ? '' : 's'}` : 'done' })),
  ], [app.sides, app.bgRuns, app.activeSide]);
  const recentProjects = settings?.recentProjects || NONE;
  const pinnedProjects = settings?.pinnedProjects || NONE;
  const shell = useStableActions({
    onOpenSub: (s: SubChat) => { if (s.kind === 'task') app.openBg(s.id); else { app.setActiveSide(s.id); if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false }); } },
    onOpen: (id: string) => app.openChat(id),
    onDelete: (id: string) => app.deleteChat(id),
    onNew: () => app.newChat(),
    onPickProject: (dir?: string) => app.pickProject(dir),
    onOpenIn: (dir: string, id: string) => { app.wantChat.current = id; app.pickProject(dir); },
    onForgetProject: (dir: string) => app.saveSettings({ recentProjects: recentProjects.filter((d) => d !== dir), pinnedProjects: pinnedProjects.filter((d) => d !== dir) }),
    onPinProject: (dir: string, on: boolean) => app.saveSettings({ pinnedProjects: on ? [...pinnedProjects.filter((d) => d !== dir), dir] : pinnedProjects.filter((d) => d !== dir) }),
    onSettings: () => app.setSettingsOpen(true),
    onPalette: () => app.setPaletteOpen(true),
    onToggleThreads: () => app.toggleThreads(),
    onResizeStart: (e: React.PointerEvent) => app.startThreadsResize(e),
    onResizeReset: () => app.resetThreadsWidth(),
    onTheme: () => app.saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }),
    onShortcuts: () => app.setShortcutsOpen(true),
    onTerminal: () => app.openTool('term'),
    // The top bar hands its click event to onPickProject, so it gets a wrapper that takes no folder.
    onPickAnyProject: () => app.pickProject(),
    setMode: (m: Mode) => app.setMode(m),
    onToggleRecording: () => app.toggleRecording(),
    onInstallUpdate: () => api.updateInstall(),
    onTogglePanel: () => app.togglePanel(),
  });
  const busy = !!app.job;
  const hasChat = app.chat.length > 0;
  const prefersLight = usePrefersLight();
  // Scans of the chat, so they're redone when it changes, not on every render.
  const currentTitle = useMemo(() => (app.chat.length ? chatTitle(app.chat) : ''), [app.chat]);
  const currentNeedsInput = useMemo(() => needsInput(app.chat), [app.chat]);
  const refreshKey = useMemo(() => `${app.chatId}:${app.chat.length}:${app.others.map((o) => o.id + o.running).join()}`, [app.chatId, app.chat.length, app.others]);
  const chatTools = useMemo(() => (!app.threadsOn && app.projectDir ? (
    <>
      <button className="icon-btn" onClick={shell.onNew} disabled={busy || !hasChat} title={`New chat (${combo('O', true)})`}><SquarePen size={16} /></button>
      <ChatHistory currentId={app.chatId} disabled={busy} others={app.others} onOpen={shell.onOpen} onDelete={shell.onDelete} />
    </>
  ) : null), [app.threadsOn, app.projectDir, busy, hasChat, app.chatId, app.others, shell]);
  if (!settings) return <div className="boot"><Loader2 className="spin" /></div>;

  return (
    <div className={`app ${app.resizing ? 'resizing' : ''} ${app.threadsOn ? 'threads-on' : ''} ${app.zen ? 'zen' : ''} chat-${app.chatLayout} ${app.chatLayout === 'tab' && app.chatTabOn ? 'chat-tab-on' : ''}`} style={app.gridStyle}>
      {app.threadsOn && (
        <ThreadSidebar
          subChats={subChats} onOpenSub={shell.onOpenSub}
          mod={MOD} projectDir={app.projectDir} recentProjects={recentProjects}
          chatId={app.chatId} currentTitle={currentTitle} currentRunning={!!app.runId} currentNeedsInput={currentNeedsInput}
          others={app.others} pulls={app.pulls} refreshKey={refreshKey} disabled={busy}
          onOpen={shell.onOpen} onDelete={shell.onDelete} onNew={shell.onNew} onPickProject={shell.onPickProject}
          onOpenIn={shell.onOpenIn} onForgetProject={shell.onForgetProject}
          pinnedProjects={pinnedProjects} onPinProject={shell.onPinProject}
          onSettings={shell.onSettings} onPalette={shell.onPalette} onHide={shell.onToggleThreads}
          onResizeStart={shell.onResizeStart} onResizeReset={shell.onResizeReset} resizing={app.resizing === 'threads'}
          onTheme={shell.onTheme} onShortcuts={shell.onShortcuts} onTerminal={shell.onTerminal} light={app.theme === 'light' || (app.theme === 'system' && prefersLight)}
        />
      )}
      <TopBar
        threadsHidden={!app.threadsOn} onToggleThreads={shell.onToggleThreads} onPalette={shell.onPalette}
        chatTools={chatTools}
        mod={MOD} projectDir={settings.projectDir} onPickProject={shell.onPickAnyProject}
        mode={app.mode} setMode={shell.setMode}
        recording={!!app.rec} canRecord={/^(https?|file):/.test(app.nav.url)} onToggleRecording={shell.onToggleRecording}
        update={app.update} onInstallUpdate={shell.onInstallUpdate}
        sheet={app.sheet} setSheet={app.setSheet}
        design={app.design?.exists ? (settings.useDesign ? 'on' : 'off') : 'none'} designChanged={app.designChanged} memoryOn={app.memoryOn}
        panelSide={app.left ? 'left' : 'right'} panelHidden={!!settings.panelHidden} onTogglePanel={shell.onTogglePanel}
        onSettings={shell.onSettings}
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
