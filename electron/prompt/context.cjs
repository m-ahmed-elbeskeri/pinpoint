const { clipBody } = require('./describe.cjs');
const { DIAGNOSTICS_HOW, DESIGN_SYSTEM_RULE, SITE_BUILT, SITE_LIVE, VARIANT_FIRST, VARIANT_NEXT } = require('./rules.cjs');

const fence = (out, heading, body) => out.push(heading, '```', ...body, '```');

function fmtConsole(c) {
  const at = c.file ? `  (${c.file}${c.fileLine ? ':' + c.fileLine : ''})` : c.source ? `  (${c.source}${c.line ? ':' + c.line : ''})` : '';
  return `[${c.level}]${c.count > 1 ? ` (x${c.count})` : ''} ${c.message}${at}`;
}

function fmtDiagnostics(d) {
  if (!d) return null;
  const out = [];
  if (d.overlay?.trim()) fence(out, 'Error overlay the dev server is showing over the page right now (usually the root cause; start here):', [d.overlay.trim()]);
  if (d.console?.length) fence(out, 'Browser console (most recent last):', d.console.map(fmtConsole));
  if (d.network?.length) {
    fence(out, 'Failed network requests:', d.network.map((n) => `${n.method || 'GET'} ${n.url} -> ${n.status || n.error}${n.handler ? `  (handled by ${n.handler})` : ''}`));
    for (const n of d.network.filter((x) => x.body?.trim()).slice(-4)) {
      out.push(`What ${n.method || 'GET'} ${n.url} answered:`, '```', clipBody(n.body, 1500), '```');
    }
  }
  if (d.a11y?.length) {
    out.push('Accessibility violations (axe-core, WCAG A/AA):');
    for (const v of d.a11y) {
      out.push(`- [${v.impact || 'issue'}] ${v.help} (${v.id}, ${v.count} element${v.count > 1 ? 's' : ''})`);
      for (const n of v.nodes) out.push(`  - \`${n.target}\`: ${n.summary}`);
    }
  }
  if (d.devLog?.trim()) fence(out, 'Dev server output (tail):', [d.devLog.trim()]);
  if (d.serverLog?.trim()) fence(out, 'Server output (from the log the user pointed Pinpoint at):', [d.serverLog.trim()]);
  return out.length ? out.join('\n') : null;
}

function fmtDesignSystem(ds) {
  if (!ds) return [];
  const out = ['## Design system (detected in the project)'];
  if (ds.tailwind) out.push(`- Tailwind CSS${ds.tailwind.version ? ` ${ds.tailwind.version}` : ''}${ds.tailwind.config ? ` (theme in ${ds.tailwind.config})` : ''}: style with utilities from the theme scale, not arbitrary values.`);
  if (ds.libraries.length) out.push(`- Component library: ${ds.libraries.join(', ')}${ds.componentsConfig ? ` (${ds.componentsConfig})` : ''}. Use and extend its components and variants before writing new ones.`);
  if (ds.styling.length) out.push(`- Styling: ${ds.styling.join(', ')}`);
  if (ds.tokenFiles.length) out.push(`- CSS-variable tokens are defined in: ${ds.tokenFiles.map((f) => `${f.file} (${f.count})`).join(', ')}`);
  if (ds.tokens.length) out.push(`- Tokens: ${ds.tokens.slice(0, 80).map((t) => `${t.name}: ${t.value}`).join('; ')}${ds.tokens.length > 80 ? '; …' : ''}`);
  out.push(DESIGN_SYSTEM_RULE);
  return out;
}

function emulatedState(env) {
  const out = [];
  if (env?.colorScheme) out.push(`prefers-color-scheme: ${env.colorScheme} (the user is looking at the ${env.colorScheme} theme, so the request is about that theme unless they say otherwise; keep the other theme intact)`);
  if (env?.reducedMotion) out.push('prefers-reduced-motion: reduce (the request is about the reduced-motion experience)');
  if (env?.frozen) out.push('the page is frozen with transient UI (a menu, tooltip, popover or modal) held open, so some annotated elements only exist while that UI is open');
  if (env?.profile) out.push(`viewing as the "${env.profile.name}" profile${env.profile.detail ? ` (${env.profile.detail})` : ''}: what is on screen is what that user sees`);
  if (env?.states?.length) out.push(`simulated conditions, switched on by the user to test the layout: ${env.states.join('; ')}. The page is meant to cope with these; don't "fix" the simulated content itself`);
  return out;
}

function contextSections({ design, memory, diagnostics, route, env, designSystem }) {
  const out = [];
  if (route?.file) out.push(`Current route: ${route.path} (rendered by ${route.file}${route.framework ? `, ${route.framework}` : ''})`, '');
  const emulated = emulatedState(env);
  if (emulated.length) out.push('Page state when the user sent this:', ...emulated.map((l) => `- ${l}`), '');
  const diag = fmtDiagnostics(diagnostics);
  if (diag) {
    out.push('## Runtime diagnostics from the page');
    out.push("These came from the user's browser session. Fix them if they relate to the request or the user asks; otherwise mention anything that looks serious.");
    out.push(DIAGNOSTICS_HOW);
    out.push(diag);
  }
  if (memory?.length) {
    out.push('## Project memory (preferences the user asked you to remember)');
    for (const m of memory) out.push(`- ${m.text.trim()}`);
  }
  if (design?.trim()) {
    const body = design.length > 12000 ? design.slice(0, 12000) + '\n…(truncated)' : design;
    out.push('## Design rules (DESIGN.md at the project root; follow these)');
    out.push(body.trim());
  }
  const ds = fmtDesignSystem(designSystem);
  if (ds.length) out.push('', ...ds);
  return out;
}

function variantNote(v) {
  if (!v) return [];
  const out = [`## Variant ${v.index} of ${v.total}`];
  out.push(v.index === 1 ? VARIANT_FIRST(v.total) : VARIANT_NEXT(v.index));
  out.push('End your summary with one line describing what makes this variant distinct.');
  return out;
}

function siteNote(site) {
  const local = site.local ? ` The same page on their machine is ${site.local}.` : '';
  return `${site.kind === 'live' ? SITE_LIVE : SITE_BUILT}${local}`;
}

module.exports = { fmtDiagnostics, contextSections, variantNote, siteNote };
