import type { ChatItem } from '../../../types';

// Nothing in a visual can reach the network, the app or the user's site: no same-origin, and a CSP that only allows
// what's inline in the page itself.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
const BASE = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><style>html,body{margin:0;background:transparent;color:#e7e7ea;font:13px system-ui,sans-serif}</style>`;

export function VisualItem({ item }: { item: Extract<ChatItem, { kind: 'visual' }> }) {
  return (
    <figure className="visual-item">
      {item.title && <figcaption>{item.title}</figcaption>}
      <iframe title={item.title || 'Visual from the agent'} sandbox="allow-scripts" srcDoc={BASE + item.html} style={{ height: item.height }} />
    </figure>
  );
}
