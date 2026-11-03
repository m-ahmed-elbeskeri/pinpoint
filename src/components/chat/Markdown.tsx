const HEX = /(#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b)/;

function WithSwatches({ text }: { text: string }) {
  const parts = text.split(HEX);
  if (parts.length === 1) return <>{text}</>;
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="hex"><i style={{ background: p }} />{p}</span> : p))}</>;
}

// [text](url) and bare web addresses. Pages on this computer open in Pinpoint's browser, the rest in your browser.
const LINK = /(\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|(?:https?:\/\/|www\.)[^\s<>()\]]*[^\s<>()\].,;:!?'"])/;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/;

export function openLink(url: string) {
  if (LOCAL.test(url)) window.dispatchEvent(new CustomEvent('pinpoint:open-url', { detail: url.replace('0.0.0.0', 'localhost') }));
  else window.pinpoint.openExternal(url).catch(() => { /* not an address the app will open */ });
}

function Linked({ text }: { text: string }) {
  const parts = text.split(LINK);
  if (parts.length === 1) return <WithSwatches text={text} />;
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p ? <WithSwatches key={i} text={p} /> : null;
        const named = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
        const href = named ? named[2] : /^www\./.test(p) ? `https://${p}` : p;
        return <a key={i} href={href} title={href} onClick={(e) => { e.preventDefault(); openLink(href); }}>{named ? named[1] : p}</a>;
      })}
    </>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') ? <code key={i}>{LINK.test(p.slice(1, -1)) && /^(https?:\/\/|www\.)\S+$/.test(p.slice(1, -1)) ? <Linked text={p.slice(1, -1)} /> : <WithSwatches text={p.slice(1, -1)} />}</code>
          : p.startsWith('**') && p.endsWith('**') ? <strong key={i}><Linked text={p.slice(2, -2)} /></strong>
            : <span key={i}><Linked text={p} /></span>,
      )}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        if (i % 2 === 1) {
          const nl = b.indexOf('\n');
          return <pre key={i}><code>{nl >= 0 ? b.slice(nl + 1) : b}</code></pre>;
        }
        return b.split(/\n{2,}/).filter((para) => para.trim()).map((para, j) => {
          const lines = para.split('\n');
          if (lines.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
            return (
              <ul key={`${i}-${j}`}>
                {lines.map((l, k) => {
                  const depth = Math.min(3, Math.floor((l.match(/^\s*/)?.[0].length || 0) / 2));
                  return <li key={k} style={depth ? { marginLeft: depth * 14 } : undefined}><Inline text={l.replace(/^\s*([-*]|\d+\.)\s/, '')} /></li>;
                })}
              </ul>
            );
          }
          const h = para.match(/^#{1,4}\s+(.*)$/);
          if (h && lines.length === 1) return <h4 key={`${i}-${j}`}><Inline text={h[1]} /></h4>;
          if (lines.every((l) => l.startsWith('>'))) return <blockquote key={`${i}-${j}`}><Inline text={lines.map((l) => l.replace(/^>\s?/, '')).join(' ')} /></blockquote>;
          if (/^#{1,4}\s/.test(lines[0]) && lines.length > 1) {
            return <div key={`${i}-${j}`}><h4><Inline text={lines[0].replace(/^#{1,4}\s+/, '')} /></h4><Markdown text={lines.slice(1).join('\n')} /></div>;
          }
          return <p key={`${i}-${j}`}>{lines.map((l, k) => <span key={k}>{k > 0 && <br />}<Inline text={l} /></span>)}</p>;
        });
      })}
    </div>
  );
}
