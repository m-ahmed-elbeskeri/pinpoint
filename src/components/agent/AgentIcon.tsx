import claudecode from '@lobehub/icons-static-svg/icons/claudecode.svg?raw';
import codex from '@lobehub/icons-static-svg/icons/codex.svg?raw';
import geminicli from '@lobehub/icons-static-svg/icons/geminicli.svg?raw';
import cursor from '@lobehub/icons-static-svg/icons/cursor.svg?raw';
import githubcopilot from '@lobehub/icons-static-svg/icons/githubcopilot.svg?raw';
import qwen from '@lobehub/icons-static-svg/icons/qwen.svg?raw';
import opencode from '@lobehub/icons-static-svg/icons/opencode.svg?raw';
import amp from '@lobehub/icons-static-svg/icons/amp.svg?raw';
import goose from '@lobehub/icons-static-svg/icons/goose.svg?raw';

// Official marks from LobeHub's icon set (@lobehub/icons-static-svg, MIT). They draw in the current
// text colour; agents without a mark in the set get a lettered badge.
const LOGOS: Record<string, string> = {
  claude: claudecode, codex, gemini: geminicli, cursor, copilot: githubcopilot, qwen, opencode, amp, goose,
};

export function AgentIcon({ id, name, size = 14 }: { id: string; name: string; size?: number }) {
  const svg = LOGOS[id];
  if (svg) return <span className="agent-icon" style={{ fontSize: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  return <span className="agent-icon letter" style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }} aria-hidden="true">{(name || id).trim().charAt(0).toUpperCase()}</span>;
}
