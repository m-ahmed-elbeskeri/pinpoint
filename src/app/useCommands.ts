import { MOD, QUICK_SIZES, api, combo } from './shared';
import type { Command } from '../components/shell/CommandPalette';
import { type SlashCommand, useComposerAssist } from '../components/agent/ComposerAssist';
import { DEVICE_OFF } from '../components/page/DeviceBar';
import { AppWindow, Boxes, Brain, Bug, CircleDot, ClipboardCopy, Columns2, Columns3, FileTree, FolderOpen, GitCompareArrows, GitPullRequestArrow, History, Keyboard, LayoutGrid, Maximize, MessageSquare, MousePointer2, MousePointerClick, NewWindow, Palette, PanelLeft, PenTool, Pin, Plus, RotateCw, Search, Settings as SettingsIcon, ShieldCheck, Snowflake, SquarePen, TerminalSquare, Users, Zap } from '../components/ui/icons';
import { layoutReport } from '../lib/layoutReport';
import type { ChatMeta } from '../types';
import { errText } from '../lib/util';
import { useEffect, useRef, useState } from 'react';
import type { AppContext } from './context';

export function useCommands(app: AppContext) {
  const settings = app.settings;
  const [paletteChats, setPaletteChats] = useState<ChatMeta[]>([]);
  const [paletteHits, setPaletteHits] = useState<{ id: string; title: string; snippet: string }[]>([]);
  const searchTimer = useRef(0);
  const searchChats = (q: string) => {
    clearTimeout(searchTimer.current);
    if (q.length < 2) { setPaletteHits([]); return; }
    searchTimer.current = window.setTimeout(() => api.searchChats(q).then(setPaletteHits).catch(() => setPaletteHits([])), 180);
  };
  useEffect(() => {
    if (app.paletteOpen && app.projectDir) api.listChats().then(setPaletteChats).catch(() => setPaletteChats([]));
  }, [app.paletteOpen, app.projectDir]);
  const slashCommands: SlashCommand[] = [
    { name: 'new', hint: 'Start a new chat', icon: SquarePen, run: app.newChat },
    { name: 'timeline', hint: 'The page after each run in this chat', icon: History, run: () => app.setTimelineOpen(true) },
    { name: 'side', hint: 'Ask something in a side chat', icon: MessageSquare, run: (rest) => app.newSide(rest || undefined) },
    { name: 'annotate', hint: 'Click or draw on the page (S)', icon: MousePointerClick, run: () => app.setMode('select') },
    { name: 'draw', hint: 'Arrows, boxes and text on the page (D)', icon: PenTool, run: () => app.setMode('draw') },
    { name: 'sketch', hint: 'Sketch on a blank board (K)', icon: SquarePen, run: () => app.setMode('sketch') },
    { name: 'browse', hint: 'Use the page normally (V)', icon: MousePointer2, run: () => app.setMode('browse') },
    ...(settings?.agent === 'claude' || settings?.agent === 'codex' ? [
      { name: 'plan', hint: app.planMode ? 'Plan only is on' : 'Plan only: the agent proposes, changes nothing', icon: Brain, run: () => { app.setPlanMode(true); app.flash('Plan only: the agent will propose changes without making them. /edit to switch back.'); } },
      { name: 'edit', hint: app.planMode ? 'Let the agent edit files again' : 'Edit files is on', icon: PenTool, run: () => { app.setPlanMode(false); app.flash('The agent can edit files again.'); } },
    ] : []),
    { name: 'terminal', hint: 'Show the terminal (Ctrl+J)', icon: TerminalSquare, run: () => app.setDrawerOpen(true) },
    { name: 'files', hint: 'Browse and read the project', icon: FileTree, run: () => app.openTool('files') },
    { name: 'pr', hint: 'Open a pull request from this chat', icon: GitPullRequestArrow, run: () => app.setBranchCompare({ pr: true }) },
    { name: 'zen', hint: 'Just the page and the chat', icon: Maximize, run: app.toggleZen },
    { name: 'theme', hint: 'Switch light / dark', icon: Palette, run: () => app.saveSettings({ theme: document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }) },
    { name: 'settings', hint: 'Open settings', icon: SettingsIcon, run: () => app.setSettingsOpen(true) },
    { name: 'save', hint: 'Save the text after /save as a snippet', icon: Pin, run: (rest) => app.saveSnippet(rest) },
    ...(settings?.snippets || []).map((sn) => ({ name: sn.name, hint: sn.text.slice(0, 80), icon: Pin, run: () => { app.setInstruction(sn.text); app.focusComposer(0); } })),
  ];
  const assist = useComposerAssist(app.composerRef, app.instruction, app.setInstruction, slashCommands);
  const commands: Command[] = !settings ? [] : [
    { id: 'chat:timeline', group: 'Chat', label: 'Timeline of this chat', hint: 'the page after each run', icon: History, disabled: !app.chat.some((it) => it.kind === 'done' && it.shots), run: () => app.setTimelineOpen(true) },
    { id: 'chat:aside', group: 'Chat', label: 'New side chat', hint: 'ask without touching this chat', icon: MessageSquare, keys: combo('A', true), disabled: !app.projectDir, run: () => app.newSide() },
    ...app.sides.map((x) => ({ id: `chat:${x.id}`, group: 'Chat', label: x.title, hint: 'side chat', icon: MessageSquare, run: () => app.setActiveSide(x.id) })),
    { id: 'chat:new', group: 'Chat', label: 'New chat', icon: SquarePen, keys: combo('O', true), disabled: !!app.job || !app.chat.length, run: app.newChat },
    { id: 'chat:pr', group: 'Chat', label: 'Open a pull request from this chat', hint: 'description and screenshots', icon: GitPullRequestArrow, disabled: !app.gitStatus?.repo || !app.chat.length, run: () => app.setBranchCompare({ pr: true }) },
    { id: 'chat:share', group: 'Chat', label: 'Hand this chat to a teammate…', hint: 'saves a file they can open', icon: Users, disabled: !app.chatId, run: () => { if (app.chatId) api.shareChat(app.chatId).then((f) => { if (f) app.flash(`Saved ${f}. Push your branch so they can pick up the code too.`); }).catch((e) => app.flash(errText(e))); } },
    { id: 'chat:receive', group: 'Chat', label: 'Open a chat from a teammate…', icon: Users, disabled: !app.projectDir || !!app.job, run: app.receiveChat },
    { id: 'view:files', group: 'View', label: 'Files', hint: 'tree and code viewer', icon: FileTree, keys: combo('E', true), disabled: !app.projectDir, run: () => app.openTool('files') },
    { id: 'view:zen', group: 'View', label: app.zen ? 'Leave zen mode' : 'Zen mode', hint: 'just the page and the chat', icon: Maximize, keys: `${MOD} .`, run: app.toggleZen },
    { id: 'view:split', group: 'View', label: settings.split ? 'Show tools over the page' : 'Show tools beside the page', icon: Columns2, run: () => app.saveSettings({ split: !settings.split }) },
    { id: 'view:layouts', group: 'View', label: 'Save or delete layouts…', icon: LayoutGrid, run: () => app.setLayoutsOpen(true) },
    ...(settings.layouts || []).map((l) => ({ id: `layout:${l.name}`, group: 'View', label: `Layout: ${l.name}`, icon: LayoutGrid, run: () => app.applyLayout(l) })),
    ...paletteHits.filter((h) => h.id !== app.chatId).map((h) => ({ id: `hit:${h.id}`, group: 'In chats', label: h.title || 'Untitled', hint: h.snippet, icon: Search, disabled: !!app.job, run: () => app.openChat(h.id) })),
    ...paletteChats.filter((c) => c.id !== app.chatId).map((c) => ({ id: `chat:${c.id}`, group: 'Chat', label: c.title || 'Untitled', hint: app.others.find((o) => o.id === c.id)?.running ? 'working' : 'open chat', icon: MessageSquare, disabled: !!app.job, run: () => app.openChat(c.id) })),
    { id: 'view:threads', group: 'View', label: settings.threadsHidden ? 'Show chats sidebar' : 'Hide chats sidebar', icon: PanelLeft, keys: combo('B', true), run: app.toggleThreads },
    { id: 'view:panel', group: 'View', label: settings.panelHidden ? 'Show agent panel' : 'Hide agent panel', icon: PanelLeft, keys: combo('B'), run: app.togglePanel },
    { id: 'view:term', group: 'View', label: app.drawerOpen ? 'Hide terminal and logs' : 'Show terminal and logs', icon: TerminalSquare, keys: combo('J'), run: () => app.setDrawerOpen(!app.drawerOpen) },
    { id: 'mode:browse', group: 'Mode', label: 'Browse the page', icon: MousePointer2, keys: 'V', run: () => app.setMode('browse') },
    { id: 'mode:select', group: 'Mode', label: 'Annotate: click an element or drag to draw', icon: MousePointerClick, keys: 'S', run: () => app.setMode('select') },
    { id: 'mode:draw', group: 'Mode', label: 'Draw on the page', icon: PenTool, keys: 'D', run: () => app.setMode('draw') },
    { id: 'mode:sketch', group: 'Mode', label: 'Sketch on a blank board', icon: SquarePen, keys: 'K', run: () => app.setMode('sketch') },
    { id: 'mode:rec', group: 'Mode', label: app.rec ? 'Stop recording' : 'Record an interaction', icon: CircleDot, disabled: !/^(https?|file):/.test(app.nav.url), run: app.toggleRecording },
    { id: 'page:tab', group: 'Page', label: 'New tab', icon: Plus, keys: combo('T'), run: () => app.newTab() },
    { id: 'page:reload', group: 'Page', label: 'Reload page', icon: RotateCw, run: () => app.browser.current?.reload() },
    ...QUICK_SIZES.map((q) => ({ id: `page:size:${q.w}`, group: 'Page', label: q.w ? `Preview at ${q.label.split(' (')[0]}` : 'Preview at full window size', icon: q.icon, run: () => { app.setMulti(false); app.setDevice(q.w ? { on: true, w: q.w, h: q.h, zoom: app.device.zoom, touch: app.device.touch } : DEVICE_OFF); } })),
    { id: 'page:multi', group: 'Page', label: 'Phone, tablet and desktop side by side', icon: Columns3, disabled: !/^(https?|file):/.test(app.nav.url), run: () => app.setMulti(true) },
    { id: 'page:freeze', group: 'Page', label: app.frozen ? 'Unfreeze the page' : 'Freeze the page', icon: Snowflake, keys: 'F', run: () => app.setFrozen(!app.frozen) },
    { id: 'page:sweep', group: 'Page', label: 'Check every page for problems', icon: ShieldCheck, disabled: !app.projectDir || !/^https?:/.test(app.nav.url), run: () => app.setSweepOpen(true) },
    { id: 'page:engines', group: 'Page', label: 'See this page in WebKit and Firefox', icon: AppWindow, disabled: !/^https?:/.test(app.nav.url), run: () => app.setEnginesOpen(true) },
    { id: 'page:components', group: 'Page', label: 'Components workspace', icon: Boxes, disabled: !app.projectDir || !/^https?:/.test(app.nav.url), run: () => app.setWsOpen(true) },
    { id: 'page:devtools', group: 'Page', label: 'Page DevTools', icon: Bug, run: () => app.browser.current?.devtools() },
    ...app.harnesses.map((h) => ({ id: `agent:${h.id}`, group: 'Agent', label: `Use ${h.name}`, hint: app.agents && !app.agents[h.id]?.ok ? 'not installed' : app.agents?.[h.id]?.version, icon: Zap, disabled: settings.agent === h.id || !!app.runId, run: () => app.saveSettings({ agent: h.id }) })),
    { id: 'git:changes', group: 'Project', label: 'Branch changes and PR preview', hint: 'compare with any base branch', icon: GitCompareArrows, disabled: !app.gitStatus?.repo, run: () => app.setBranchCompare({}) },
    { id: 'proj:design', group: 'Project', label: 'Design rules', icon: Palette, disabled: !app.projectDir, run: () => app.setSheet('design') },
    { id: 'proj:memory', group: 'Project', label: 'Project memory', icon: Brain, disabled: !app.projectDir, run: () => app.setSheet('memory') },
    { id: 'proj:open', group: 'Project', label: 'Open project folder…', icon: FolderOpen, run: () => app.pickProject() },
    ...(settings.recentProjects || []).filter((d) => d !== app.projectDir).map((d) => ({ id: `proj:${d}`, group: 'Project', label: `Switch to ${d.split(/[\\/]/).pop()}`, hint: d, icon: FolderOpen, disabled: !!app.job, run: () => app.pickProject(d) })),
    ...(settings.recentProjects || []).filter((d) => d !== app.projectDir).map((d) => ({ id: `win:${d}`, group: 'Project', label: `Open ${d.split(/[\\/]/).pop()} in a new window`, hint: d, icon: NewWindow, run: () => { api.openProjectWindow(d).catch((e) => app.flash(errText(e))); } })),
    ...(['system', 'light', 'dark'] as const).map((t) => ({ id: `app:theme:${t}`, group: 'App', label: `Theme: ${t === 'system' ? 'match the system' : t}`, icon: Palette, disabled: app.theme === t, run: () => app.saveSettings({ theme: t }) })),
    { id: 'app:shortcuts', group: 'App', label: 'Keyboard shortcuts', icon: Keyboard, keys: '?', run: () => app.setShortcutsOpen(true) },
    { id: 'app:statusbar', group: 'View', label: settings.statusBar ? 'Hide status bar' : 'Show status bar', icon: PanelLeft, run: () => app.saveSettings({ statusBar: !settings.statusBar }) },
    { id: 'app:settings', group: 'App', label: 'Settings', icon: SettingsIcon, run: () => app.setSettingsOpen(true) },
    { id: 'app:layout', group: 'App', label: 'Copy layout report', icon: ClipboardCopy, keys: combo('L', true), run: () => { navigator.clipboard?.writeText(layoutReport()); app.flash('Layout report copied.'); } },
  ];

  Object.assign(app, { assist, commands, searchChats, setPaletteHits });
}
