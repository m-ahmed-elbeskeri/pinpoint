import { MultiView } from '../panels';
import { api } from '../shared';
import { NotePopover } from './NotePopover';
import { BrowserView } from '../../components/page/BrowserView';
import { DeviceBar } from '../../components/page/DeviceBar';
import { DrawSurface } from '../../components/page/DrawSurface';
import { DrawToolbar } from '../../components/page/DrawToolbar';
import { CircleDot, Loader2, Snowflake } from '../../components/ui/icons';
import { MockupOverlay } from '../../components/page/MockupOverlay';
import { Onboarding } from '../../components/shell/Onboarding';
import { Welcome } from '../../components/shell/Welcome';
import { ComponentsPanel } from '../../components/page/Workbench';
import { partitionOf } from '../../lib/urls';
import type { AppContext } from '../context';

export function PageFrame({ app }: { app: AppContext }) {
  const settings = app.settings!;
  return (
    <div className={`frame-wrap ${app.device.on ? 'device' : ''}`}>
      {app.device.on && <DeviceBar device={app.device} set={app.setDevice} scale={app.deviceScale} height={app.deviceH} breakpoints={app.breakpoints} />}
      <div className="device-area" ref={app.area}>
        <div className="device-box" style={app.device.on ? { width: app.device.w * app.deviceScale, height: app.deviceH * app.deviceScale } : undefined}>
          <div ref={app.frame} className={`frame mode-${app.mode}`} style={app.device.on ? { width: app.device.w, height: app.deviceH, transform: `scale(${app.deviceScale})` } : undefined}>
            {app.tabs.map((t) => {
              const here = () => t.id === app.activeTab;
              return (
                <BrowserView
                  key={`${t.id}:${t.profile}`}
                  ref={(h) => { app.handles.current[t.id] = h; if (here()) app.browser.current = h; }}
                  hidden={t.id !== app.activeTab}
                  partition={partitionOf(t.profile)}
                  initialUrl={t.initialUrl}
                  onManip={(m) => { if (here()) app.onManip(m); }}
                  onScribble={(points) => { if (here()) app.addScribble(points); }}
                  onPicked={(el) => { if (here()) app.onPicked(el); }}
                  onNavigate={(s) => {
                    app.patchTab(t.id, s);
                    if (here() && document.activeElement?.closest('.urlbar') == null) app.setUrlInput(s.url === 'about:blank' ? '' : s.url);
                  }}
                  onLoading={(l) => app.patchTab(t.id, { loading: l })}
                  onReady={() => { app.applyTabProfile(t); if (here()) app.syncPage(); }}
                  onKey={(k) => { if (here()) app.handleKey(k); }}
                  onError={(msg) => app.patchTab(t.id, { error: msg })}
                  onConsole={(c) => { if (!here()) return; app.onConsole(c); if (c.level === 'error') app.tapRef.current?.errors.push(c.message.split('\n')[0].slice(0, 200)); }}
                  onPageChange={() => { if (here()) { app.clearDiagnostics(); app.setFrozenState(false); app.setA11y([]); } }}
                  onFrozen={(on) => { if (here()) app.onFrozen(on); }}
                  onStep={(s) => { if (here()) app.onStep(s); }}
                  onRequest={(r) => { if (here()) app.onRequest(r); }}
                />
              );
            })}

            {app.overlay && app.mode !== 'sketch' && <MockupOverlay overlay={app.overlay} onChange={app.setOverlay} onDiff={app.diffMockup} onMatch={app.matchMockup} canMatch={!app.runId && !app.job && !app.busy} onClose={() => app.setOverlay(null)} />}
            {app.frozen && <div className="frozen-tag"><Snowflake size={12} /> Page frozen · press F to release</div>}
            {app.rec && <div className="frozen-tag rec"><CircleDot size={12} /> Recording · {app.rec.steps.length} step{app.rec.steps.length === 1 ? '' : 's'} <button onClick={app.toggleRecording}>Stop</button></div>}
            {app.isolated && <div className="frozen-tag iso">Showing one element on its own <button onClick={() => app.isolate(null)}>Show page</button></div>}

            {app.mode === 'select' && app.page.shapes.length > 0 && (
              <DrawSurface shapes={app.page.shapes} onChange={app.page.set} tool={app.tool} color={app.color} size={app.size} passive />
            )}
            {app.mode === 'draw' && (
              <DrawSurface shapes={app.page.shapes} onChange={app.page.set} tool={app.tool} color={app.color} size={app.size} />
            )}
            {app.mode === 'sketch' && (
              <DrawSurface shapes={app.sketch.shapes} onChange={app.sketch.set} tool={app.tool} color={app.color === '#ffffff' ? '#111318' : app.color} size={app.size} board />
            )}

            <NotePopover app={app} />

            {(app.mode === 'draw' || app.mode === 'sketch') && (
              <DrawToolbar
                tool={app.tool} setTool={app.setTool} color={app.color} setColor={app.setColor} size={app.size} setSize={app.setSize}
                canUndo={app.drawShapes.canUndo} canRedo={app.drawShapes.canRedo}
                onUndo={app.drawShapes.undo} onRedo={app.drawShapes.redo} onClear={() => app.drawShapes.set([])}
                onCommit={app.commitCurrent} commitLabel={app.mode === 'sketch' ? 'Add sketch' : 'Add drawing'} count={app.drawShapes.shapes.length}
              />
            )}

            {app.mode === 'select' && !app.popover && <div className="mode-hint">Click to annotate · drag to draw · Esc to exit</div>}

            {(!app.nav.url || app.nav.url === 'about:blank') && app.mode !== 'sketch' && (
              <Welcome
                projectDir={settings.projectDir}
                onOpenProject={app.pickProject}
                devCommand={app.devCommand}
                devLabel={app.devInfo?.candidates.find((c) => c.command === app.devCommand)?.label}
                devRunning={app.devRunning}
                runningUrl={app.devRunning ? null : app.devInfo?.runningUrl}
                onOpenUrl={app.go}
                onStartDev={app.quickStartDev}
                onSketch={() => app.setMode('sketch')}
                onTool={app.openTool}
                setup={!settings.onboarded && app.agents && (!app.projectDir || !app.agentReady) ? (
                  <Onboarding
                    agents={app.agents} harnesses={app.harnesses} current={settings.agent} projectDir={app.projectDir}
                    onPick={(agent) => app.saveSettings({ agent })} onRecheck={() => api.detectAgents().then(app.setAgents).catch(() => {})}
                    onTerminal={() => app.openTool('term')} onOpenProject={() => app.pickProject()} onSettings={() => app.setSettingsOpen(true)}
                    onDone={() => app.saveSettings({ onboarded: true })}
                  />
                ) : null}
              />
            )}
            {app.loadError && app.nav.url !== 'about:blank' && (
              <div className="load-error">
                <b>Couldn't load the page</b><span>{app.loadError}</span>
                <div>
                  <button className="btn xs" onClick={() => app.browser.current?.reload()}>Retry</button>
                  <button className="btn xs ghost" onClick={app.quickStartDev} title={app.devCommand || undefined}>Start dev server</button>
                </div>
              </div>
            )}
            {app.busy && <div className="busy"><Loader2 size={14} className="spin" /> {app.busy}</div>}
          </div>
          {app.device.on && (
            <>
              <div className="device-grip x" onPointerDown={app.startDeviceResize('x')} title="Drag to change the width" />
              <div className="device-grip y" onPointerDown={app.startDeviceResize('y')} title="Drag to change the height" />
              <div className="device-grip xy" onPointerDown={app.startDeviceResize('xy')} title="Drag to resize" />
              <span className="device-size">{app.device.w} × {Math.round(app.deviceH)}{app.deviceScale !== 1 ? ` · ${Math.round(app.deviceScale * 100)}%` : ''}</span>
            </>
          )}
        </div>
      </div>
      {app.wsOpen && (
        <ComponentsPanel
          render={(spec) => app.browser.current?.workspace({ ...spec, abs: `${app.projectDir}/${spec.file}`.split('\\').join('/'), left: Math.round(270 / app.deviceScale) }) ?? Promise.resolve(null)}
          close={() => app.browser.current?.closeWorkspace()}
          onClose={() => app.setWsOpen(false)}
        />
      )}
      {app.multi && <MultiView url={app.nav.url} onNavigate={app.go} onPick={(w, h) => { app.setMulti(false); app.setDevice({ on: true, w, h, zoom: 'fit', touch: app.device.touch }); }} onClose={() => app.setMulti(false)} />}
    </div>
  );
}
