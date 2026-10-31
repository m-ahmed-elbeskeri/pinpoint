import { api, snippetName } from './shared';
import { uid } from '../lib/draw';
import { useRef, useState } from 'react';
import type { AppContext } from './context';

export function useComposer(app: AppContext) {
  const settings = app.settings;
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pastes, setPastes] = useState<{ id: string; text: string }[]>([]);
  const [pasteOpen, setPasteOpen] = useState<string | null>(null);
  const historyAt = useRef(-1);
  const focusComposer = (delay = 30, atEnd = false) => {
    setTimeout(() => {
      const c = composerRef.current;
      if (!c) return;
      c.focus({ preventScroll: true });
      if (atEnd) c.selectionStart = c.selectionEnd = c.value.length;
    }, delay);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const onPaste = (e: React.ClipboardEvent) => {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); app.addReferences(files); return; }
    // A long paste becomes a chip that goes with the message, instead of a wall of text in the box.
    const text = e.clipboardData.getData('text/plain');
    if ((e.target as HTMLElement).closest('.composer-box') && (text.length > 2000 || text.split('\n').length > 30)) {
      e.preventDefault();
      setPastes((list) => [...list, { id: uid(), text }]);
    }
  };
  // Files dropped from the computer: images become references, anything else is mentioned by path.
  const dropFiles = (files: FileList) => {
    const all = [...files];
    const images = all.filter((f) => f.type.startsWith('image/'));
    if (images.length) app.addReferences(images);
    const root = (app.settings?.projectDir || '').replace(/\\/g, '/').replace(/\/$/, '');
    const refs = all.filter((f) => !f.type.startsWith('image/')).map((f) => api.pathForFile(f).replace(/\\/g, '/')).filter(Boolean)
      .map((p) => (root && p.toLowerCase().startsWith(root.toLowerCase() + '/') ? `@${p.slice(root.length + 1)}` : /\s/.test(p) ? `"${p}"` : p));
    if (refs.length) {
      setInstruction((v) => `${v}${v && !/\s$/.test(v) ? ' ' : ''}${refs.join(' ')} `);
      focusComposer();
    }
  };
  const mention = (path: string) => {
    setInstruction((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}@${path} `);
    if (app.settings?.panelHidden) app.saveSettings({ panelHidden: false });
    app.setActiveSide(null);
    focusComposer();
  };
  const canSend = !busy && !!(instruction.trim() || pastes.length || app.annotations.length || app.pendingMarks);
  const root = settings?.projectDir || '';
  const planMode = settings?.agent === 'codex' ? settings.codexSandbox === 'read-only' : settings?.agent === 'claude' ? settings.claudePermission === 'plan' : false;
  const setPlanMode = (on: boolean) => app.saveSettings(app.settings?.agent === 'codex' ? { codexSandbox: on ? 'read-only' : 'workspace-write' } : { claudePermission: on ? 'plan' : 'acceptEdits' });
  const saveSnippet = (text: string) => {
    const t = text.trim();
    if (!t) { app.flash('Type the text after /save, e.g. /save make it responsive'); return; }
    const list = app.settings?.snippets || [];
    let name = snippetName(t);
    for (let i = 2; list.some((x) => x.name === name); i++) name = `${snippetName(t)}-${i}`;
    app.saveSettings({ snippets: [...list, { name, text: t }] });
    app.flash(`Saved as /${name}`);
  };

  Object.assign(app, { busy, canSend, composerRef, dropFiles, focusComposer, fileInput, historyAt, instruction, mention, onPaste, pasteOpen, pastes, planMode, root, saveSnippet, setBusy, setInstruction, setPasteOpen, setPastes, setPlanMode });
}
