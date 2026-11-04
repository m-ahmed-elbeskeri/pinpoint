import { BackgroundChat } from '../../components/agent/BackgroundChat';
import { api } from '../shared';
import { useEffect, useState } from 'react';
import { MATCH_ROUNDS, MOD, combo } from '../shared';
import { Composer } from './Composer';
import { ChatList } from '../../components/chat';
import { EmptyChat } from '../../components/shell/EmptyChat';
import { ArrowDown, Check, CornerDownRight, GitPullRequestArrow, History, ImagePlus, Loader2, MessageSquare, Plus, SquarePen, X, SquareStack, Expand, FloatIcon, PanelRight, ChevronDown, TabIcon } from '../../components/ui/icons';
import { Dropdown } from '../../components/ui/Dropdown';
import { PullIcon } from '../../components/git/PullIcon';
import { SideChat } from '../../components/agent/SideChat';
import { chatTitle } from '../../lib/chat';
import type { AppContext } from '../context';

// Time since this run started; remounted per run by its key.
function Elapsed() {
  const [start] = useState(Date.now);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.floor((Date.now() - start) / 1000);
  return <span className="working-time">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`}</span>;
}

function LayoutIcon({ layout }: { layout: string }) {
  const Icon = layout === 'expanded' ? Expand : layout === 'tab' ? TabIcon : layout === 'floating' ? FloatIcon : PanelRight;
  return <Icon size={13} />;
}

export function ChatPanel({ app }: { app: AppContext }) {
  const settings = app.settings!;
  const [dragOver, setDragOver] = useState(false);
  const { floatOpen, setFloatOpen } = app;
  const layout = app.chatLayout;
  // As a tab and not in front, it floats as a composer; opening it brings its tab to the front.
  const lastReply = (() => { for (let i = app.chat.length - 1; i >= 0; i--) { const it = app.chat[i]; if (it.kind === 'user') return null; if (it.kind === 'text' && it.text.trim()) return it; } return null; })();
  // While it's small, the bar says what the agent is doing, so there's no need to open the chat to check.
  const step = (() => { if (!app.runId) return ''; for (let i = app.chat.length - 1; i >= 0; i--) { const it = app.chat[i]; if (it.kind === 'user') break; if (it.kind === 'tool') return `${it.name} ${(it.detail || '').split(/[\/]/).pop()}`.trim(); } return 'Thinking'; })();
  const mini = (layout === 'floating' && !floatOpen && !app.activeSide) || (layout === 'tab' && !app.chatTabOn);
  return (
    <aside
      className={`panel ${app.left ? 'left' : 'right'} ${app.activeSide ? 'side-active' : ''} ${mini ? 'float-mini' : layout === 'floating' ? 'float-open' : ''}`}
      style={settings.panelHidden ? { display: 'none' } : undefined}
      onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); app.dropFiles(e.dataTransfer.files); }}
    >
      {dragOver && <div className="drop-zone"><ImagePlus size={26} /><b>Drop files here</b><span>Images become references; other files are mentioned by path</span></div>}
      <div
        className={`resizer col ${app.resizing === 'panel' ? 'on' : ''}`}
        onPointerDown={app.startResize('panel')}
        onDoubleClick={() => { app.setPanelWidth(null); app.saveSettings({ panelWidth: 400 }); }}
        title="Drag to resize · double-click to reset"
      />
      {mini && lastReply && (
        <button className="chat-peek" onClick={() => (layout === 'tab' ? app.setChatTabOn(true) : setFloatOpen(true))} title="Open the chat">
          <span>{lastReply.text.replace(/\s+/g, ' ').slice(0, 280)}</span>
        </button>
      )}
      {(layout === 'floating' || (layout === 'tab' && !app.chatTabOn)) && (
        <button className="float-toggle" onClick={() => (layout === 'tab' ? app.setChatTabOn(true) : setFloatOpen(!floatOpen))} title={floatOpen ? 'Show just the composer' : 'Show the whole chat'}>
          {app.runId ? <Loader2 size={12} className="spin" /> : <MessageSquare size={12} />}
          <span>{app.runId ? <>Working{step ? <em> · {step}</em> : null}</> : chatTitle(app.chat) || 'Chat'}</span>
          <ChevronDown size={12} className={floatOpen ? 'flip' : ''} />
        </button>
      )}
      <div className="panel-head" onDoubleClick={(e) => { if (!(e.target as HTMLElement).closest('button, .dd')) app.setChatLayout(layout === 'expanded' ? 'docked' : 'expanded'); }}>
        <div className="panel-tabs" ref={app.tabsStrip} onScroll={app.fadeTabs} onWheel={(e) => { if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>
          <button className={`ptab ${app.activeSide ? '' : 'on'}`} onClick={() => app.setActiveSide(null)} title={chatTitle(app.chat) || 'This chat'}>
            {app.runId ? <Loader2 size={12} className="spin" /> : <MessageSquare size={12} />}<span>Chat</span>
          </button>
          {app.chatId && <PullIcon pull={app.pulls[app.branchOf.current.get(app.chatId) || '']} branch={app.branchOf.current.get(app.chatId)} />}
          {app.chatId && app.gitStatus?.repo && app.gitStatus.remote && app.gitStatus.branch && app.gitStatus.branch !== app.gitStatus.defaultBranch && !app.pulls[app.gitStatus.branch] && app.recentFiles.length > 0 && (
            <button className="ptab-new" onClick={() => app.setBranchCompare({ pr: true })} title="Open a pull request from this chat"><GitPullRequestArrow size={13} /></button>
          )}
          {app.activeBg && (
            <div className="ptab side on" title={app.activeBg.title}>
              {app.activeBg.status === 'running' ? <Loader2 size={12} className="spin" /> : <SquareStack size={12} />}<span>{app.activeBg.title}</span>
              <button className="ptab-x" onClick={() => app.setActiveSide(null)} title="Back to the chat"><X size={11} /></button>
            </div>
          )}
          {app.sides.map((x) => (
            <div key={x.id} className={`ptab side ${app.activeSide === x.id ? 'on' : ''}`} onClick={() => app.setActiveSide(x.id)} title={x.title}>
              {x.running ? <Loader2 size={12} className="spin" /> : <CornerDownRight size={12} />}<span>{x.title}</span>
              <button className="ptab-x" onClick={(e) => { e.stopPropagation(); app.closeSide(x.id); }} title="Close side chat"><X size={11} /></button>
            </div>
          ))}
          {app.chat.some((it) => it.kind === 'done' && it.shots) && <button className="ptab-new ptab-timeline" onClick={() => app.setTimelineOpen(true)} title="Timeline: the page after each run in this chat"><History size={13} /></button>}
          <button className="ptab-new" onClick={() => app.newSide()} disabled={!app.projectDir} title={`New side chat: ask without touching this chat (${combo('A', true)})`}><Plus size={13} /></button>
        </div>
        <div className="spacer" />
        <Dropdown
          className="layout-pick" align="right" title="Where the chat sits" tooltip={`Where the chat sits (${combo('\\', true)} to cycle)`}
          value={layout} display="" icon={<LayoutIcon layout={layout} />}
          onChange={(v) => app.setChatLayout(v as typeof layout)}
          items={[
            { value: 'docked', label: 'Beside the page', desc: 'Double-click the header to make it the main view', icon: <PanelRight size={14} /> },
            { value: 'expanded', label: 'Main view', desc: 'The chat in the big area, the page beside it', icon: <Expand size={14} /> },
            { value: 'tab', label: 'As a tab', desc: 'Next to your pages; floats as a composer over a page', icon: <TabIcon size={14} /> },
            { value: 'floating', label: 'Floating', desc: 'Just the composer over the page until you open it', icon: <FloatIcon size={14} /> },
          ]}
        />
        <button className="btn ghost xs panel-new quiet" onClick={app.newChat} disabled={!!app.job || !app.chat.length} title={`${app.runId ? 'Start another chat. This one keeps working.' : app.session ? 'Continuing the same agent session. Click to start fresh.' : 'Start a fresh agent session'} (${combo('O', true)})`}><SquarePen size={13} /><span className="btn-text">New chat</span></button>
      </div>
      {app.activeBg && (
        <BackgroundChat
          run={app.activeBg} agentName={app.agentName}
          onSend={(text) => app.askBg(app.activeBg!, text)}
          onStop={() => { api.bgStop(app.activeBg!.id).catch(() => {}); }}
          onApply={() => app.applyBg(app.activeBg!)}
          onDiff={() => api.bgDiff(app.activeBg!.id).then((text) => app.setPatchView({ title: app.activeBg!.title, text }))}
          onDiscard={() => app.discardBg(app.activeBg!)}
        />
      )}
      {app.sides.map((x) => (
        <SideChat
          key={x.id} sideId={x.id} active={app.activeSide === x.id} agentName={app.agentName}
          seed={x.seed} onSeedUsed={() => app.patchSide(x.id, { seed: null })} getContext={app.sideContext}
          onTitle={(title) => app.patchSide(x.id, { title })} onRunning={(running) => app.patchSide(x.id, { running })}
        />
      ))}
      {app.others.length > 0 && !app.threadsOn && (
        <div className="other-chats">
          {app.others.map((o) => (
            <button key={o.id} className={o.running ? 'running' : 'finished'} onClick={() => app.openChat(o.id)} title={o.running ? 'Still working. Click to look.' : 'Finished. Click to see the result.'}>
              {o.running ? <Loader2 size={11} className="spin" /> : <Check size={11} />}
              <span>{o.title || 'Untitled'}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`chat-wrap ${app.away ? 'away' : ''}`}>
        <div className="chat" ref={app.chatBox} onScroll={(e) => { app.onChatScroll(e); app.markBelow(); if (app.askAside) app.setAskAside(null); }} onWheel={app.onChatWheel} onMouseUp={app.onChatMouseUp}>
          {app.chat.length === 0 ? (
            <EmptyChat agentName={app.agentName} cliMissing={!!app.agents && !app.agentReady} mod={MOD} onPick={(text) => { app.setInstruction(text); requestAnimationFrame(() => { const t = app.composerRef.current; if (t) { t.focus(); t.setSelectionRange(text.length, text.length); } }); }} />
          ) : <ChatList items={app.chat} actions={app.chatActions} root={app.root} gitRepo={!!app.gitStatus?.repo} busy={!!app.runId || !!app.job} />}
          {(app.runId || app.job) && (
            <div className="working">
              <Loader2 size={14} className="spin" />{' '}
              <span className="shimmer">{app.job || `${app.runMeta?.variant ? `Variant ${app.runMeta.variant.index} of ${app.runMeta.variant.total}: ` : ''}${app.agentName} is ${app.runMeta?.verify ? 'checking the result' : app.runMeta?.match ? `matching the mockup, round ${app.runMeta.match} of ${MATCH_ROUNDS}` : 'working'}…`}</span>
              <Elapsed key={app.runId || app.job || ''} />
            </div>
          )}
          <div ref={app.chatEnd} />
        </div>
        {app.away && app.chat.length > 0 && (
          <div className="to-latest">
            <button className={app.away.fresh ? 'fresh' : ''} onClick={app.toLatest} title="Go to the latest message">
              <ArrowDown size={13} /> {app.away.fresh ? 'New messages' : 'Latest'}
            </button>
          </div>
        )}
      </div>

      <Composer app={app} />
    </aside>
  );
}
