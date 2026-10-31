import { useEffect, useState } from 'react';
import { CheckCircle2, DotsThree, EyeOff, Gauge, GitCommitHorizontal, GitCompareArrows, Route, RotateCw, SealCheck, SplitSquareHorizontal, Timer, Undo2, XCircle } from '../../ui/icons';
import { FileList, FileRow } from '../Diffs';
import { BuildLine, FlowLine, PerfLine, PerfStats } from '../ResultMetrics';
import type { ChatActions, ItemOf } from '../types';

const shotCache = new Map<string, Promise<Record<string, string>>>();
function ShotStrip({ runId, onOpen }: { runId: string; onOpen(): void }) {
  const [shots, setShots] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    if (!shotCache.has(runId)) shotCache.set(runId, window.pinpoint.runShots(runId, ['before', 'after']).catch(() => ({})));
    shotCache.get(runId)!.then((s) => { if (live) setShots(s); });
    return () => { live = false; };
  }, [runId]);
  if (!shots?.before || !shots?.after) return null;
  return (
    <button className="shot-strip" onClick={onOpen} title="Compare before and after">
      <figure><img src={shots.before} alt="Before" /><figcaption>Before</figcaption></figure>
      <figure><img src={shots.after} alt="After" /><figcaption>After</figcaption></figure>
      <span className="shot-cta"><SplitSquareHorizontal size={12} /> Compare</span>
    </button>
  );
}

export function DoneItem({ item, busy, gitRepo, actions }: { item: ItemOf<'done'>; busy: boolean; gitRepo: boolean; actions: ChatActions }) {
  const [loadStats, setLoadStats] = useState(false);
  const [moreActs, setMoreActs] = useState(false);
  const n = item.changes.length;
  const files = `${n} file${n > 1 ? 's' : ''}`;
  const moved = item.routeCheck?.filter((r) => r.changed) || [];
  const here = item.routeCheck?.find((r) => r.current);
  const noVisual = n > 0 && item.ok && !item.undone && !item.variant && !item.verify && !item.unseen && (here ? !here.changed : item.visual === 'none');
  const elsewhere = moved.filter((r) => !r.current);
  const sideEffects = moved.some((r) => r.current && r.asked?.length && r.areas?.length);
  const others = (item.routeCheck?.filter((r) => !r.current) || []).length;
  const counted = item.changes.filter((c) => c.add != null);
  const added = counted.reduce((s, c) => s + (c.add || 0), 0), removed = counted.reduce((s, c) => s + (c.del || 0), 0);
  const quiet = !!item.verify && n === 0;
  return (
    <div id={`done-${item.id}`} className={`done-card ${item.ok ? 'ok' : 'fail'} ${item.undone ? 'undone' : ''} ${quiet ? 'quiet' : ''}`}>
      <div className="done-head">
        <i className="done-icon">{item.verify && item.ok ? <SealCheck size={quiet ? 14 : 15} weight="fill" /> : item.ok ? <CheckCircle2 size={15} weight="fill" /> : <XCircle size={15} weight="fill" />}</i>
        <span>
          {item.instant && !item.undone ? `Applied instantly · ${files}`
            : item.background && !item.undone ? `Background run applied · ${files}`
            : item.variant ? `Variant ${item.variant.index} of ${item.variant.total}${n ? ` · ${files}` : ''}${item.ok ? '' : ' · stopped'}`
            : item.verify ? (n ? `Checked the result and fixed ${files}` : item.ok ? 'Checked the result: looks right' : 'Check stopped')
              : item.undone ? 'Reverted' : n ? `Changed ${files}` : item.ok ? 'Done, no file changes' : 'Stopped'}
        </span>
        {counted.length > 0 && !item.undone && <span className="df-stat" title="Lines added and removed across these files"><i className="add">+{added}</i><i className="del">−{removed}</i></span>}
        <span className="done-meta">
          {item.durationMs ? `${Math.round(item.durationMs / 1000)}s` : ''}
          {item.cost ? ` · $${item.cost.toFixed(2)}` : ''}
        </span>
        {noVisual && <span className="no-visual-tag"><EyeOff size={11} /> No visible change</span>}
        {item.commit && (
          <span className="commit-chip" title={item.commit.subject} onClick={() => navigator.clipboard?.writeText(item.commit!.hash)}>
            <GitCommitHorizontal size={12} /> {item.commit.hash}
          </span>
        )}
      </div>
      {n > 0 && (
        <FileList count={n}>
          {item.changes.map((c) => (
            <FileRow
              key={c.path}
              runId={item.runId}
              change={item.undone ? { ...c, reverted: true } : c}
              disabled={busy}
              onReview={() => actions.onReview(item.runId, c.path)}
              onRevert={(force) => actions.onRevertFile(item.runId, c.path, force)}
              onOpen={(line) => actions.onOpenFile(c.path, line)}
            />
          ))}
        </FileList>
      )}
      {noVisual && (
        <div className="no-visual">
          <EyeOff size={14} />
          <div>
            <b>No visible change on this page{moved.length ? ' · other pages changed' : ''}</b>
            <span className="why">The files were edited, but the page looks the same as before. The change may not apply to what's on screen, may be overridden by another style, or may only show in another state or size.</span>
          </div>
        </div>
      )}
      {item.unseen && n > 0 && !item.undone && (
        <div className="no-visual unseen">
          <EyeOff size={14} />
          <div>
            <b>{item.unseen === 'live' ? "Not visible here yet: you're on the live site" : 'Not visible here yet: this is a built copy'}</b>
            <span className="why">{item.unseen === 'live' ? 'The files in your project were edited. The deployed page will show the change once you deploy it.' : 'The files were edited, but this page is served from a build made earlier. It shows the change once it is rebuilt.'}</span>
            <span><button className="link-btn" onClick={actions.onOpenLocal}>See it locally</button></span>
          </div>
        </div>
      )}
      {item.shots && !noVisual && <ShotStrip runId={item.runId} onOpen={() => actions.onCompare(item.runId)} />}
      {item.routeCheck && moved.length === 1 && moved[0].current && !elsewhere.length && !sideEffects ? (
        <div className="where quiet">
          <div className="where-head">
            <Route size={12} />
            <span>Visual check · <button className="link-btn" onClick={() => actions.onCompare(item.runId, `route-${moved[0].key}`)} title="Compare this page before and after">{moved[0].pct}%</button>{moved[0].areas?.length ? ` on ${moved[0].areas.join(', ')}` : ''}{others ? ` · ${others} other${others === 1 ? '' : 's'} unchanged` : ''}</span>
          </div>
        </div>
      ) : item.routeCheck && (
        <div className={`where ${elsewhere.length || sideEffects ? 'moved' : moved.length ? '' : 'quiet'}`}>
          <div className="where-head">
            <Route size={12} />
            {elsewhere.length
              ? <span>Also changed {elsewhere.length} other page{elsewhere.length > 1 ? 's' : ''}. Check {elsewhere.length > 1 ? 'they were' : 'it was'} meant to:</span>
              : sideEffects ? <span>More changed on this page than you pointed at:</span>
              : moved.length ? <span>Visual check{others ? ` · ${others} other page${others === 1 ? '' : 's'} unchanged` : ''}</span>
                : <span>{item.routeCheck.length} page{item.routeCheck.length > 1 ? 's' : ''} checked, none look different</span>}
          </div>
          {moved.map((r) => (
            <div key={r.key} className="where-row">
              <button className={`chip mono ${r.current ? '' : 'warn'}`} onClick={() => actions.onCompare(item.runId, `route-${r.key}`)} title="Compare this page before and after">{r.current ? 'this page' : r.route} · {r.pct}%</button>
              {r.asked?.length
                ? <span>{r.asked.join(', ')} <i>(what you pointed at)</i>{r.areas?.length ? <b> and also {r.areas.join(', ')}</b> : '; nothing else here'}</span>
                : <span>{r.areas?.length ? r.areas.join(', ') : 'changed'}</span>}
            </div>
          ))}
        </div>
      )}
      {item.flow && <FlowLine flow={item.flow} onFix={() => actions.onFlowFix(item.runId)} />}
      {item.perf && <PerfLine perf={item.perf} />}
      {item.perf && loadStats && <PerfStats perf={item.perf} />}
      {item.build && <BuildLine build={item.build} />}
      {!(item.verify && n === 0) && <div className={`done-actions ${moreActs ? 'more' : ''}`}>
        {n > 0 && (
          <button className="btn xs" onClick={() => actions.onReview(item.runId)} title="See exactly what changed and revert individual files">
            <GitCompareArrows size={12} /> Review
          </button>
        )}
        {n > 0 && !item.undone && (
          <button className="btn ghost xs" disabled={busy} onClick={() => actions.onUndo(item.id, item.runId)} title="Restore these files to how they were before this run">
            <Undo2 size={12} /><span className="btn-text">Undo</span>
          </button>
        )}
        {gitRepo && n > 0 && !item.undone && !item.commit && item.ok && (
          <button className="btn ghost xs more-act" disabled={busy} onClick={() => actions.onCommit(item.runId)} title="Commit the files this run changed">
            <GitCommitHorizontal size={12} /><span className="btn-text">Commit</span>
          </button>
        )}
        {n > 0 && !item.undone && item.ok && (
          <button className="btn ghost xs more-act" disabled={busy} onClick={() => actions.onMeasureBuild(item.runId)} title="Run the project's build and measure the JS and CSS it produces (the per-run numbers come from the dev server)">
            <Gauge size={12} /><span className="btn-text">Build size</span>
          </button>
        )}
        {item.perf && (
          <button className={`btn ghost xs load-stats-btn more-act ${loadStats ? 'on' : ''}`} onClick={() => setLoadStats(!loadStats)} title="How this page loads, before and after this change">
            <Timer size={12} /><span className="btn-text">Load stats</span>
          </button>
        )}
        <button className="btn ghost xs more-act" onClick={actions.onReload} title="Reload the page"><RotateCw size={12} /><span className="btn-text">Reload</span></button>
        <button className={`btn ghost xs done-more ${moreActs ? 'on' : ''}`} onClick={() => setMoreActs(!moreActs)} title={moreActs ? 'Fewer actions' : 'More: commit, build size, load stats, reload'}><DotsThree size={14} /></button>
      </div>}
    </div>
  );
}
