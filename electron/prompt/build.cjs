const fs = require('node:fs');
const { describeAnnotation, clipBody } = require('./describe.cjs');
const { fmtDiagnostics, contextSections, variantNote, siteNote } = require('./context.cjs');
const { REMEMBER_RULE, HOW_TO_WORK, STEP_BACKGROUND, STEP_SITE, STEP_DEV, STEP_FINISH, INTRO, RESPONSIVE, VERIFY_SAME, VERIFY_CLOSE } = require('./rules.cjs');

function isEmptyProject(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length === 0;
  } catch { return false; }
}

function buildPrompt({ request, files, projectDir, followUp, design, memory, designSystem }) {
  const { url, title, viewport, breakpoints, instruction, annotations, diagnostics, route, env, variant, note, site, carried } = request;
  const hasAnn = annotations.length > 0;
  const empty = isEmptyProject(projectDir);
  const ctx = contextSections({ design: followUp ? '' : design, memory, diagnostics, route, env, designSystem: followUp ? null : designSystem });
  const variantLines = variantNote(variant);

  if (followUp && !hasAnn) {
    return [
      ...(note ? [note, ''] : []),
      ...(variantLines.length ? [...variantLines, ''] : []),
      instruction?.trim() || (variant ? '(Same request as before.)' : 'Continue.'),
      '',
      site ? `(The user is still looking at ${url} in the Pinpoint visual editor. ${siteNote(site)})` : `(The user is still looking at ${url} in the Pinpoint visual editor. The dev server hot-reloads; do not start it.)`,
      ...(ctx.length ? ['', ...ctx] : []),
      '',
      REMEMBER_RULE,
    ].join('\n');
  }

  const out = [];
  out.push(followUp
    ? '# Follow-up visual change request (from Pinpoint)'
    : '# Visual change request (from Pinpoint)');
  out.push('');
  out.push(INTRO(projectDir));
  out.push('');
  out.push(`- Page: ${url}${title ? ` ("${title}")` : ''}`);
  if (site) out.push(`- ${siteNote(site)}`);
  if (viewport) out.push(`- Viewport: ${viewport.width}×${viewport.height} CSS px${viewport.width < 800 ? ' (mobile/tablet width: the request may be about responsive layout)' : ''}`);
  if (viewport?.responsive) {
    out.push(RESPONSIVE(viewport.width));
    if (breakpoints?.length) {
      const active = (b) => (b.kind === 'min' ? viewport.width >= b.px : viewport.width <= b.px);
      out.push(`- Breakpoints in the page's CSS: ${breakpoints.map((b) => `${b.kind}-width ${b.px}px${active(b) ? ' (active)' : ''}`).join(', ')}`);
    }
  }
  if (files.overview) out.push(`- Full viewport screenshot with numbered markers matching the annotations below: ${files.overview}`);
  if (empty) out.push('- The project folder is empty: create the page from scratch (a self-contained `index.html` unless the user asks for a framework).');
  out.push('');

  if (note) { out.push(note); out.push(''); }
  if (variantLines.length) { out.push(...variantLines); out.push(''); }
  if (carried?.trim() && !followUp) {
    out.push('## Earlier in this conversation');
    out.push('This chat started with another agent session, which you cannot see. Here is what was said, for context:');
    out.push('<earlier-conversation>', carried.trim(), '</earlier-conversation>', '');
  }

  if (instruction?.trim()) {
    out.push('## What the user wants');
    out.push(instruction.trim());
    out.push('');
  }

  if (ctx.length) { out.push(...ctx); out.push(''); }

  if (hasAnn) {
    out.push('## Annotations');
    out.push('Each annotation is numbered; the number also appears on the overview screenshot.');
    out.push('');
    for (const a of annotations) {
      out.push(describeAnnotation(a));
      if (a.pageUrl && a.pageUrl !== url) out.push(`- This annotation is on a different page than the one above: ${a.pageUrl}`);
      out.push('');
    }
  }

  out.push('## How to work');
  out.push(...HOW_TO_WORK);
  out.push(request.background ? STEP_BACKGROUND : site ? STEP_SITE : STEP_DEV);
  out.push(STEP_FINISH);
  out.push('');
  out.push(REMEMBER_RULE);
  return out.join('\n');
}

function buildSteerPrompt({ request, files, mode }) {
  const lead = mode === 'now'
    ? '[The user interrupted you with this message. Follow it from here.]'
    : '[The user sent this while you were working. Take it into account from here on; no need to restart work that is already fine.]';
  const body = request.annotations.length
    ? buildPrompt({ request, files, projectDir: '', followUp: true, design: '', memory: [] })
    : (request.instruction || '').trim();
  const diag = request.diagnostics && fmtDiagnostics(request.diagnostics);
  return [lead, '', body, ...(diag && !request.annotations.length ? ['', diag] : [])].join('\n');
}

function buildVerifyPrompt({ request }) {
  const { verify, diagnostics, url } = request;
  const out = ['[Automatic check from Pinpoint, not a message from the user.]', ''];
  out.push(`Your changes have hot-reloaded. This is how ${url} renders now:`);
  out.push(`- After your changes: ${verify.afterFile}`);
  if (verify.beforeFile) out.push(`- Before your changes: ${verify.beforeFile}`);
  out.push('(Both screenshots are attached.)', '');
  if (verify.same) out.push(VERIFY_SAME, '');
  const diag = fmtDiagnostics(diagnostics);
  if (diag) out.push('Problems reported by the page, and server output, since your changes:', diag, '');
  if (verify.requests?.length) {
    out.push('The request the user pointed at was sent again after your changes:');
    for (const r of verify.requests) {
      out.push(`- \`${r.method} ${r.url}\`: before ${r.before?.status ?? 'no response'}, now ${r.after.error && !r.after.status ? `no response (${r.after.error})` : r.after.status}`);
      out.push('  Response now:', '```', clipBody(r.after.body, 2500) || '(empty)', '```');
    }
    out.push('Is that the answer the user asked for? If the endpoint still fails or returns the wrong shape, fix it.', '');
  }
  if (verify.flow) {
    const f = verify.flow;
    out.push('The steps the user recorded were replayed after your changes (the "after" screenshot is the page at the end of them):');
    out.push(f.done < f.total ? `- It stopped at step ${f.done + 1} of ${f.total}: the element that step uses was not on the page.` : `- All ${f.total} steps ran.`);
    for (const x of f.errors || []) out.push(`- Console error during the replay: ${x}`);
    for (const x of f.failed || []) out.push(`- Request that failed during the replay: ${x}`);
    if (f.done >= f.total && !f.errors?.length && !f.failed?.length) out.push('- No errors came up.');
    out.push('');
  }
  out.push('Check your work against what the user asked for:');
  out.push('1. Does the "after" screenshot show the change they wanted, in the place they pointed at?');
  out.push('2. Did anything else on the page break or shift that should not have (compare with "before")?');
  out.push(`3. ${diag ? 'Are the problems above caused by your changes?' : 'No new console or network errors were reported.'}`);
  out.push('');
  out.push(VERIFY_CLOSE);
  return out.join('\n');
}

module.exports = { buildPrompt, buildSteerPrompt, buildVerifyPrompt };
