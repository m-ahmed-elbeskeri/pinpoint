interface Props {
  agentName: string;
  cliMissing: boolean;
}

export function EmptyChat({ agentName, cliMissing }: Props) {
  return (
    <div className="chat-empty">
      {cliMissing && <div className="warn-box">{agentName} CLI wasn't found. Install it or set its path in Settings.</div>}
    </div>
  );
}
