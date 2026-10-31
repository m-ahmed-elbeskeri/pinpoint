import { api } from './shared';
import { chatTitle, needsInput } from '../lib/chat';
import { useEffect } from 'react';
import type { AppContext } from './context';

export function useAppStatus(app: AppContext) {
  const settings = app.settings;
  const waitingCount = app.others.filter((o) => o.needsInput || !o.running).length + (needsInput(app.chat) ? 1 : 0);
  useEffect(() => { api.badge(waitingCount).catch(() => {}); }, [waitingCount]);
  const trayChats = [
    ...(app.chatId && app.chat.length && (app.runId || needsInput(app.chat)) ? [{ id: app.chatId, title: chatTitle(app.chat), state: needsInput(app.chat) ? 'needs you' : 'working' }] : []),
    ...app.others.map((o) => ({ id: o.id, title: o.title, state: o.needsInput ? 'needs you' : o.running ? 'working' : 'done' })),
  ];
  const trayKey = JSON.stringify(trayChats) + settings?.tray;
  useEffect(() => {
    if (!settings) return;
    api.tray({ working: trayChats.filter((c) => c.state === 'working').length, waiting: trayChats.filter((c) => c.state === 'needs you').length, chats: trayChats }).catch(() => {});
  }, [trayKey]);
  useEffect(() => api.onTrayChat((id) => app.openChat(id)), []);

  Object.assign(app, {  });
}
