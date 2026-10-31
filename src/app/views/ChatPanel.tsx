import { useState } from 'react';
import { MATCH_ROUNDS, combo } from '../shared';
import { Composer } from './Composer';
import { ChatList } from '../../components/chat';
import { EmptyChat } from '../../components/shell/EmptyChat';
import { ArrowDown, Check, CornerDownRight, GitPullRequestArrow, History, ImagePlus, Loader2, MessageSquare, Plus, SquarePen, X } from '../../components/ui/icons';
import { PullIcon } from '../../components/git/PullIcon';
import { SideChat } from '../../components/agent/SideChat';
import { chatTitle } from '../../lib/chat';
import type { AppContext } from '../context';

export function ChatPanel({ app }: { app: AppContext }) {
  const settings = app.settings!;
  const [dragOver, setDragOver] = useState(false);
  return (
    <aside
      className={`panel ${app.left ? 'left' : 'right'} ${app.activeSide ? 'side-active' : ''}`}
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
      <div className="panel-head">
        <div className="panel-tabs" ref={app.tabsStrip} onScroll={app.fadeTabs} onWheel={(e) => { if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY; }}>
          <button className={`ptab ${app.activeSide ? '' : 'on'}`} onClick={() => app.setActiveSide(null)} title={chatTitle(app.chat) || 'This chat'}>
            {app.runId ? <Loader2 size={12} className="spin" /> : <MessageSquare size={12} />}<span>Chat</span>
          </button>
          {app.chatId && <PullIcon pull={app.pulls[app.branchOf.current.get(app.chatId) || '']} branch={app.branchOf.current.get(app.chatId)} />}
          {app.chatId && app.gitStatus?.repo && app.gitStatus.remote && app.gitStatus.branch && app.gitStatus.branch !== app.gitStatus.defaultBranch && !app.pulls[app.gitStatus.branch] && app.recentFiles.length > 0 && (
            <button className="ptab-new" onClick={() => app.setBranchCompare({ pr: true })} title="Open a pull request from this chat"><GitPullRequestArrow size={13} /></button>
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
        <button className="btn ghost xs panel-new quiet" onClick={app.newChat} disabled={!!app.job || !app.chat.length} title={`${app.runId ? 'Start another chat. This one keeps working.' : app.session ? 'Continuing the same agent session. Click to start fresh.' : 'Start a fresh agent session'} (${combo('O', true)})`}><SquarePen size={13} /><span className="btn-text">New chat</span></button>
      </div>
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
            <EmptyChat agentName={app.agentName} cliMissing={!!app.agents && !app.agentReady} />
          ) : <ChatList items={app.chat} actions={app.chatActions} root={app.root} gitRepo={!!app.gitStatus?.repo} busy={!!app.runId || !!app.job} />}
          {(app.runId || app.job) && (
            <div className="working">
              <Loader2 size={14} className="spin" />{' '}
              <span className="shimmer">{app.job || `${app.runMeta?.variant ? `Variant ${app.runMeta.variant.index} of ${app.runMeta.variant.total}: ` : ''}${app.agentName} is ${app.runMeta?.verify ? 'checking the result' : app.runMeta?.match ? `matching the mockup, round ${app.runMeta.match} of ${MATCH_ROUNDS}` : 'working'}…`}</span>
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
