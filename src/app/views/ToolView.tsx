import { DiffViewer, FilesPanel } from '../panels';
import { api } from '../shared';
import { errText } from '../../lib/util';
import { Drawer } from '../../components/tools/Drawer';
import { NetworkPanel, failed as requestFailed } from '../../components/tools/NetworkPanel';
import type { AppContext } from '../context';

export function ToolView({ app }: { app: AppContext }) {
  const settings = app.settings!;
  return (
    <>
      {app.drawerOpen && (
        <div className="tool-view">
          <Drawer
            tab={app.drawerTab} setTab={app.setDrawerTab} devLog={app.devLog} agentLog={app.agentLog}
            netFailed={app.requests.filter(requestFailed).length}
            network={
              <NetworkPanel
                requests={app.requests} mocks={app.mocks} setMocks={app.setMocks}
                findHandler={(url, method) => api.findHandler(url, method)}
                onAdd={app.addRequest} onReplay={app.replayRequest} onOpenFile={app.openFile} onBuild={app.buildMock} onClear={app.clearRequests}
              />
            }
            files={<FilesPanel recent={app.recentFiles} refreshKey={`${app.projectDir}:${app.recentFiles.length}:${app.runId || ''}`} onMention={app.mention} onOpen={app.openFile} />}
            split={!!settings.split} onSplit={() => app.saveSettings({ split: !settings.split })}
            cwd={app.projectDir} shell={settings.terminalShell} onShell={(terminalShell) => { if (terminalShell !== app.settings?.terminalShell) app.saveSettings({ terminalShell }); }}
            devRunning={app.devRunning} devCommand={app.devCommand} devCandidates={app.devInfo?.candidates} servicesRunning={app.servicesRunning}
            onService={(c, on) => { (on ? api.startService(c.command, c.label) : api.stopService(c.command)).catch((e) => app.flash(errText(e))); }}
            onStartDev={app.startDev} onStopDev={() => api.stopDev()} onClose={() => app.setDrawerOpen(false)}
          />
        </div>
      )}
      {app.diffView && (
        <DiffViewer
          runId={app.diffView.runId} initialPath={app.diffView.path}
          onClose={() => app.setDiffView(null)}
          onReverted={(r) => app.applyRevert(app.diffView!.runId, r)}
          onOpen={app.openFile}
          onExplain={(text) => app.newSide(text)}
          onSendComments={(text) => app.sendText(text)}
        />
      )}
    </>
  );
}
