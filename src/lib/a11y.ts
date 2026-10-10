async function audit() {
  const axe = (window as any).axe;
  await new Promise<void>((done) => (window.requestIdleCallback ? window.requestIdleCallback(() => done(), { timeout: 4000 }) : setTimeout(done, 200)));
  const res = await axe.run(
    { exclude: [['pinpoint-overlay']] },
    { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } },
  );
  const rank: Record<string, number> = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return res.violations
    .sort((a: any, b: any) => (rank[a.impact] ?? 4) - (rank[b.impact] ?? 4))
    .slice(0, 20)
    .map((v: any) => ({
      id: v.id,
      impact: v.impact || null,
      help: v.help,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 3).map((n: any) => ({
        target: n.target.map(String).join(' '),
        html: String(n.html || '').slice(0, 200),
        summary: String(n.failureSummary || '').replace(/\s+/g, ' ').replace(/^Fix (any|all) of the following: ?/, '').slice(0, 240),
      })),
    }));
}

export const a11yScript = (axeSource: string) => '(async () => { if (!window.axe) {\n' + axeSource + '\n}\nreturn (' + audit.toString() + ')(); })()';
