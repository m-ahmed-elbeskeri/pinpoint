// Turns a visual request (element picks, drawings, sketches, notes) into a
// prompt a coding agent can act on. Images are saved to disk beforehand and
// referenced by absolute path.
const fs = require('node:fs');
const path = require('node:path');

function isEmptyProject(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length === 0;
  } catch { return false; }
}

function fmtStyles(styles = {}) {
  return Object.entries(styles).map(([k, v]) => `${k}: ${v}`).join('; ');
}

function fmtSource(src) {
  if (!src) return null;
  const parts = [];
  if (src.file) parts.push(`${src.file}${src.line ? `:${src.line}` : ''}${src.column ? `:${src.column}` : ''}`);
  if (src.components?.length) parts.push(`component tree: ${src.components.join(' > ')}`);
  if (src.framework) parts.push(`(${src.framework})`);
  return parts.length ? parts.join('  ') : null;
}

function describeAnnotation(a) {
  const lines = [];
  const note = a.note?.trim() ? a.note.trim() : '(no note; infer the intent from the image and the overall request)';

  if (a.kind === 'element') {
    const el = a.element;
    lines.push(`### [${a.n}] Selected element: ${note}`);
    lines.push(`- Element: \`<${el.tag}${el.id ? ` id="${el.id}"` : ''}${el.classes?.length ? ` class="${el.classes.join(' ')}"` : ''}>\``);
    lines.push(`- CSS selector: \`${el.selector}\``);
    if (el.path) lines.push(`- DOM path: ${el.path}`);
    const src = fmtSource(el.source);
    if (src) lines.push(`- Source hint (from the framework's dev metadata): ${src}`);
    if (el.text) lines.push(`- Visible text: "${el.text}"`);
    lines.push(`- Rendered size: ${Math.round(el.rect.width)}×${Math.round(el.rect.height)}px at (${Math.round(el.rect.x)}, ${Math.round(el.rect.y)}) in the viewport`);
    if (el.styles) lines.push(`- Computed styles: ${fmtStyles(el.styles)}`);
    if (el.html) lines.push('- Rendered HTML (truncated):\n```html\n' + el.html + '\n```');
    if (a.imageFile) lines.push(`- Close-up screenshot: ${a.imageFile}`);
  } else if (a.kind === 'drawing') {
    lines.push(`### [${a.n}] Markup drawn on the page: ${note}`);
    lines.push(`- Screenshot of the page with the user's markup on top: ${a.imageFile}`);
    if (a.region) lines.push(`- The markup covers roughly x ${a.region.x}–${a.region.x + a.region.width}, y ${a.region.y}–${a.region.y + a.region.height} (CSS px, viewport ${a.viewport?.width}×${a.viewport?.height}).`);
    if (a.hits?.length) lines.push(`- Elements under the markup: ${a.hits.map((h) => `\`${h.selector}\`${h.text ? ` ("${h.text}")` : ''}${h.source?.file ? ` [${h.source.file}${h.source.line ? ':' + h.source.line : ''}]` : ''}`).join(', ')}`);
  } else if (a.kind === 'reference') {
    lines.push(`### [${a.n}] Reference image: ${note}`);
    lines.push(`- Image: ${a.imageFile}`);
    if (a.name) lines.push(`- File name: ${a.name}`);
    lines.push("- The user supplied this as a reference (mockup, screenshot or inspiration). Take from it what the note asks for; don't copy unrelated parts.");
  } else if (a.kind === 'sketch') {
    lines.push(`### [${a.n}] Hand-drawn sketch / wireframe: ${note}`);
    lines.push(`- Sketch image: ${a.imageFile}`);
    lines.push('- This is a wireframe of UI the user wants built. Treat boxes as containers/cards/images, squiggles as text, and handwritten words as labels or instructions.');
  }
  return lines.join('\n');
}

function fmtDiagnostics(d) {
  if (!d) return null;
  const out = [];
  if (d.console?.length) {
    out.push('Browser console (most recent last):');
    out.push('```');
    for (const c of d.console) out.push(`[${c.level}]${c.count > 1 ? ` (x${c.count})` : ''} ${c.message}${c.source ? `  (${c.source}${c.line ? ':' + c.line : ''})` : ''}`);
    out.push('```');
  }
  if (d.network?.length) {
    out.push('Failed network requests:');
    out.push('```');
    for (const n of d.network) out.push(`${n.method || 'GET'} ${n.url} -> ${n.status || n.error}`);
    out.push('```');
  }
  if (d.devLog?.trim()) {
    out.push('Dev server output (tail):');
    out.push('```');
    out.push(d.devLog.trim());
    out.push('```');
  }
  return out.length ? out.join('\n') : null;
}

// Project context that rides along with every request (first turn and follow-ups).
function contextSections({ design, memory, diagnostics, route }) {
  const out = [];
  if (route?.file) out.push(`Current route: ${route.path} (rendered by ${route.file}${route.framework ? `, ${route.framework}` : ''})`, '');
  const diag = fmtDiagnostics(diagnostics);
  if (diag) {
    out.push('## Runtime diagnostics from the page');
    out.push("These came from the user's browser session. Fix them if they relate to the request or the user asks; otherwise mention anything that looks serious.");
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
  return out;
}

const REMEMBER_RULE = 'If the user states a lasting preference for this project ("always…", "never…", "from now on…", a brand rule), end your reply with one line exactly like `REMEMBER: <the rule in one short sentence>`. Otherwise don\'t add that line.';

function buildPrompt({ request, files, projectDir, followUp, design, memory }) {
  const { url, title, viewport, instruction, annotations, diagnostics, route } = request;
  const hasAnn = annotations.length > 0;
  const empty = isEmptyProject(projectDir);
  // DESIGN.md goes in once per session; memory and diagnostics every turn.
  const ctx = contextSections({ design: followUp ? '' : design, memory, diagnostics, route });

  if (followUp && !hasAnn) {
    return [
      instruction?.trim() || 'Continue.',
      '',
      `(The user is still looking at ${url} in the Pinpoint visual editor. The dev server hot-reloads; do not start it.)`,
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
  out.push(`The user is looking at their web app in Pinpoint, a visual editor with an embedded browser. They picked elements, drew on the page and/or sketched ideas, and want you to change the code in this project (${projectDir}) so the page matches what they asked for.`);
  out.push('');
  out.push(`- Page: ${url}${title ? ` ("${title}")` : ''}`);
  if (viewport) out.push(`- Viewport: ${viewport.width}×${viewport.height} CSS px${viewport.width < 800 ? ' (mobile/tablet width: the request may be about responsive layout)' : ''}`);
  if (files.overview) out.push(`- Full viewport screenshot with numbered markers matching the annotations below: ${files.overview}`);
  if (empty) out.push('- The project folder is empty: create the page from scratch (a self-contained `index.html` unless the user asks for a framework).');
  out.push('');

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
    for (const a of annotations) { out.push(describeAnnotation(a)); out.push(''); }
  }

  out.push('## How to work');
  out.push('1. Look at the screenshots first (open each image path above). They show exactly what the user sees and marked up.');
  out.push('2. Find the source that renders each annotated element. Start from the source hint if there is one; otherwise search for distinctive visible text, class names or ids from the rendered HTML. The rendered HTML is compiled output: map it back to the component/template that produces it, and do not edit build output.');
  out.push("3. Read the user's markup this way: arrows mean move or point to; circles or boxes mean focus on this; a cross or scribble means remove; handwritten words are instructions. The pen color is only markup, not a color the user wants, unless the note says so.");
  out.push('4. Make focused edits that do exactly what was asked. Follow the conventions already in the codebase (styling approach, design tokens, component patterns). Don\'t refactor unrelated code.');
  out.push('5. The dev server is already running with hot reload, so don\'t start servers or run production builds. Run a quick type check or lint only if it is cheap.');
  out.push('6. Finish with a short summary: what you changed, with file paths, and anything you could not do or had to guess.');
  out.push('');
  out.push(REMEMBER_RULE);
  return out.join('\n');
}

// Text for a message sent while the agent is working (live steering).
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

module.exports = { buildPrompt, buildSteerPrompt };
