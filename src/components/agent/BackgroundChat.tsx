import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Loader2, Play, Square, SquareStack, X } from '../ui/icons';
import { Transcript } from './Transcript';
import type { BgRun } from '../../types';

interface Props {
  run: BgRun;
  agentName: string;
  onSend(text: string): void;
  onStop(): void;
  onApply(): void;
  onDiff(): void;
  onDiscard(): void;
}

// A background task, opened: what it's done so far, its result, and a box to keep talking to it.
export function BackgroundChat({ run, agentName, onSend, onStop, onApply, onDiff, onDiscard }: Props) {
  const [text, setText] = useState('');
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const running = run.status === 'running';
  const files = run.files?.length || 0;

  useEffect(() => { const b = body.current; if (b) b.scrollTop = b.scrollHeight; }, [run.items, run.status]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, [run.id]);

  const send = () => {
    const t = text.trim();
    if (!t || running) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="side-chat bg-chat">
      <div className="side-head">
        <SquareStack size={13} />
        <span className="side-sub" title="Works in a separate copy of the project, so your files don't change until you apply it.">Background task · {agentName} · separate copy</span>
        <div className="spacer" />
      </div>
      <div className="side-body" ref={body}><Transcript items={run.items} running={running} stepLabel="Ran" /></div>
      <div className={`bg-chat-result ${run.status}`}>
        {running ? <Loader2 size={13} className="spin" /> : run.status === 'done' ? <Check size={13} /> : <X size={13} />}
        <span className="bg-chat-state" title={run.step}>{running ? run.step || 'Working…' : run.status === 'failed' ? 'Stopped' : files ? `${files} file${files === 1 ? '' : 's'} changed` : 'No files changed'}</span>
        <div className="spacer" />
        {run.status === 'done' && files > 0 && <button className="btn xs" onClick={onDiff}>Diff</button>}
        {run.status === 'done' && files > 0 && <button className="btn xs primary bg-chat-apply" onClick={onApply} title="Bring these changes into your project"><Play size={11} /> Apply</button>}
        <button className="btn xs ghost" onClick={onDiscard} title="Throw away this task and its copy of the project">Discard</button>
      </div>
      <div className="side-foot">
        <textarea
          ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder={running ? 'You can reply when this step finishes' : 'Reply to this task…'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
        />
        {running
          ? <button className="icon-btn side-send stop" onClick={onStop} title="Stop"><Square size={10} weight="fill" /></button>
          : <button className="btn primary side-send" onClick={send} disabled={!text.trim()} title="Send (Enter)"><ArrowUp size={14} /></button>}
      </div>
    </div>
  );
}
