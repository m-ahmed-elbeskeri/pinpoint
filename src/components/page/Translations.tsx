import { useEffect, useState } from 'react';
import { Languages, Loader2, Zap } from '../ui/icons';
import type { MissingTranslations, TranslationMatch } from '../../types';
import { errText } from '../../lib/util';

interface Props {
  text: string;
  onApply(edits: { file: string; key: string; value: string }[]): Promise<void>;
  onAsk(instruction: string): void;
}

const keyOf = (m: TranslationMatch, file: string) => `${m.ns}|${m.key}|${file}`;

export function missingInstruction(list: MissingTranslations[]) {
  const lines = list.map((m) => `- ${m.file} (${m.locale}) is missing ${m.count} key${m.count === 1 ? '' : 's'} that ${m.from} (${m.fromLocale}) has: ${m.keys.slice(0, 40).join(', ')}${m.count > 40 ? ', …' : ''}`);
  return `Add the missing translations:\n${lines.join('\n')}\n\nTranslate each from the ${list[0]?.fromLocale || 'main'} text, keep placeholders like {name} or {{count}} and any markup exactly as they are, and match the tone of the strings already in each file.`;
}

/** The copy's translation keys in every language, editable in place. Shown in an element's Content tab. */
export function Translations({ text, onApply, onAsk }: Props) {
  const [found, setFound] = useState<{ files: number; matches: TranslationMatch[] } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'apply' | 'missing' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setFound(null); setDraft({});
    window.pinpoint.i18nFind(text).then((r) => { if (live) setFound(r); }).catch(() => { if (live) setFound({ files: 0, matches: [] }); });
    return () => { live = false; };
  }, [text]);
  if (!found || !found.files) return null;
  if (!found.matches.length) return <p className="hint el-hint"><Languages size={11} /> Not found in the project's {found.files} translation file{found.files === 1 ? '' : 's'}: this copy is written in the code.</p>;

  const edits = found.matches.flatMap((m) => m.values
    .filter((v) => draft[keyOf(m, v.file)] != null && draft[keyOf(m, v.file)] !== (v.value ?? ''))
    .map((v) => ({ file: v.file, key: m.key, value: draft[keyOf(m, v.file)] })));
  const gaps = found.matches.flatMap((m) => m.values.filter((v) => !v.value?.trim() && !draft[keyOf(m, v.file)]?.trim()).map((v) => ({ m, v })));
  const apply = async () => {
    setBusy('apply'); setError('');
    try { await onApply(edits); setFound((f) => f && { ...f, matches: f.matches.map((m) => ({ ...m, values: m.values.map((v) => ({ ...v, value: draft[keyOf(m, v.file)] ?? v.value })) })) }); setDraft({}); }
    catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };
  const askGaps = () => {
    const by = new Map<string, MissingTranslations>();
    for (const { m, v } of gaps) {
      const from = m.values.find((x) => /^en\b/i.test(x.locale) && x.value) || m.values.find((x) => x.value);
      const entry = by.get(v.file) || { ns: m.ns, from: from?.file || '', fromLocale: from?.locale || '', file: v.file, locale: v.locale, keys: [], count: 0 };
      entry.keys.push(m.key); entry.count++;
      by.set(v.file, entry);
    }
    onAsk(missingInstruction([...by.values()]));
  };
  const askProject = async () => {
    setBusy('missing'); setError('');
    try {
      const list = await window.pinpoint.i18nMissing();
      if (list.length) onAsk(missingInstruction(list)); else setError('Every language has every key.');
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  };

  return (
    <div className="i18n-box">
      {found.matches.map((m) => (
        <div key={`${m.ns}|${m.key}`} className="i18n-key">
          <span className="el-label mono" title={m.values.map((v) => v.file).join('\n')}><Languages size={11} /> {m.ns ? `${m.ns}:` : ''}{m.key}</span>
          {m.values.map((v) => {
            const k = keyOf(m, v.file);
            return (
              <label key={v.file} className={`el-field tall ${draft[k] != null && draft[k] !== (v.value ?? '') ? 'set' : ''} ${!v.value ? 'missing' : ''}`} title={v.file}>
                <span className="mono">{v.locale}</span>
                <input value={draft[k] ?? v.value ?? ''} placeholder="missing" spellCheck={false} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} />
              </label>
            );
          })}
        </div>
      ))}
      {error && <p className="hint el-hint err">{error}</p>}
      <div className="i18n-actions">
        <button className="el-link" disabled={!!busy} onClick={askProject} title="Find every key one language has and another doesn't, across the project, and ask the agent to translate them">
          {busy === 'missing' ? <Loader2 size={10} className="spin" /> : null} All missing in project
        </button>
        <div className="spacer" />
        {gaps.length > 0 && <button className="btn xs" disabled={!!busy} onClick={askGaps} title="Ask the agent to translate the empty ones">Translate {gaps.length} missing</button>}
        <button className="btn xs primary" disabled={!edits.length || !!busy} onClick={apply} title="Write these straight into the translation files, no agent">
          {busy === 'apply' ? <Loader2 size={12} className="spin" /> : <Zap size={12} />} Apply now
        </button>
      </div>
    </div>
  );
}
