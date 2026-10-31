import { api } from './shared';
import { useLogs } from '../lib/hooks';
import { originOf } from '../lib/site';
import type { DevDetection } from '../types';
import { useEffect, useState } from 'react';
import type { AppContext } from './context';
import { errText } from '../lib/util';

export function useDevServer(app: AppContext) {
  const settings = app.settings;
  const { devLog, agentLog, setDevLog, setAgentLog, addLog } = useLogs();
  const [devRunning, setDevRunning] = useState(false);
  const [devInfo, setDevInfo] = useState<DevDetection | null>(null);
  const [servicesRunning, setServicesRunning] = useState<string[]>([]);
  useEffect(() => api.onDevEvent((e) => {
    if (e.type === 'log') addLog('dev', e.text);
    else if (e.type === 'service') setServicesRunning((l) => (e.running ? [...l.filter((c) => c !== e.command), e.command] : l.filter((c) => c !== e.command)));
    else if (e.type === 'started') { setDevRunning(true); setDevLog(''); }
    else if (e.type === 'exit') { setDevRunning(false); setDevLog((l) => l + `\n[process exited with code ${e.code}]\n`); }
    else if (e.type === 'url') {
      const started = originOf(e.url);
      if (started) app.setTwins((t) => ({ ...t, local: started }));
      const cur = app.nav.url;
      if (!cur || cur === 'about:blank' || /^chrome-error:/.test(cur) || app.loadError) {
        setTimeout(() => app.go(e.url), 400);
      }
    }
  }), []);
  useEffect(() => {
    setDevInfo(null);
    setServicesRunning([]);
    if (!app.projectDir) return;
    let live = true;
    api.detectDev().then((d) => { if (live) setDevInfo(d); }).catch(() => {});
    return () => { live = false; };
  }, [app.projectDir]);
  const devCommand = settings?.devCommand || devInfo?.command || '';
  const startDev = async (cmd: string) => {
    try { await api.startDev(cmd); app.saveSettings({ devCommand: cmd }); }
    catch (e) { app.flash(errText(e)); }
  };
  const quickStartDev = () => {
    app.setDrawerOpen(true); app.setDrawerTab('dev');
    if (devCommand && !devRunning) startDev(devCommand);
  };

  Object.assign(app, { servicesRunning, addLog, agentLog, devCommand, devInfo, devLog, devRunning, quickStartDev, setAgentLog, setDevLog, startDev });
}
