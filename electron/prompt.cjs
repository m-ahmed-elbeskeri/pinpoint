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

// One entry per element a drawing touches: what it is, where it lives, how it looks.
function describeHit(h) {
  const parts = [`\`${h.selector}\``];
  if (h.text) parts.push(`"${h.text.length > 80 ? h.text.slice(0, 80) + '…' : h.text}"`);
  if (h.rect) parts.push(`${Math.round(h.rect.width)}×${Math.round(h.rect.height)}px`);
  const src = fmtSource(h.source);
  if (src) parts.push(`source: ${src}`);
  const lines = [`  - ${parts.join(' · ')}`];
  if (h.path) lines.push(`    DOM path: ${h.path}`);
  if (h.styles && Object.keys(h.styles).length) lines.push(`    Styles: ${fmtStyles(h.styles)}`);
  return lines.join('\n');
}

const STATE_LABEL = { hover: ':hover', focus: ':focus', 'focus-visible': ':focus-visible', active: ':active', disabled: 'disabled' };

// What the user set up on a picked element beyond the note: a forced state,
// live style tweaks, design tokens behind its values, and the component it is.
function describeElementExtras(a) {
  const el = a.element;
  const lines = [];
  if (a.states?.length) {
    const names = a.states.map((s) => STATE_LABEL[s] || s).join(' + ');
    lines.push(`- State: the user is looking at this element in its ${names} state. The computed styles and close-up below were taken in that state, so the request is about how it looks then (e.g. its \`${STATE_LABEL[a.states[0]] || a.states[0]}\` rule or variant), not its resting look, unless the note says otherwise.`);
  }
  const tweaks = Object.entries(a.tweaks || {});
  if (tweaks.length) {
    lines.push("- Live tweaks: the user adjusted these in the browser until it looked right. Make exactly these the element's styles in source (the overview screenshot shows them applied):");
    for (const [prop, value] of tweaks) {
      const was = el.styles?.[prop];
      lines.push(`  - \`${prop}\`: ${was ? `${was} → ` : ''}${value}`);
    }
    lines.push('  Express each with the project\'s own tokens, utilities or scale where one matches (say so when you had to round to the nearest step); never leave them as inline styles unless the codebase already styles that way.');
  }
  if (a.textEdit) lines.push(`- Copy change: replace the text ${JSON.stringify(a.textEdit.from)} with ${JSON.stringify(a.textEdit.to)}. Edit it where the copy lives (the component, or the content / i18n file it is read from).`);
  if (a.classEdit) {
    const before = a.classEdit.from.split(/\s+/).filter(Boolean), after = a.classEdit.to.split(/\s+/).filter(Boolean);
    const added = after.filter((c) => !before.includes(c)), removed = before.filter((c) => !after.includes(c));
    lines.push(`- Class change (tried live in the browser):${added.length ? ` add \`${added.join(' ')}\`` : ''}${added.length && removed.length ? ';' : ''}${removed.length ? ` remove \`${removed.join(' ')}\`` : ''}. Apply it to this element's class list in source.`);
  }
  if (a.reorder) lines.push(`- Moved: the user dragged this element from position ${a.reorder.from + 1} to position ${a.reorder.to + 1} of ${a.reorder.count} among its siblings${a.reorder.before ? ` (it now sits before ${a.reorder.before})` : ' (it is now last)'}. Make that the order in source.`);
  const propEdits = Object.entries(a.propEdits || {});
  if (propEdits.length) lines.push(`- Prop changes (tried live on \`<${el.component?.name || 'the component'}>\`): ${propEdits.map(([k, v]) => `${k} ${v.from} → ${v.to}`).join(', ')}. Make them at this element's call site.`);
  if (el.rules?.length) {
    lines.push('- CSS rules that style it, most specific first ("wins" = properties this rule currently decides):');
    for (const r of el.rules) {
      const where = r.utility ? ' — generated utility class: change the element\'s class list, not this rule' : r.file ? ` — ${r.file}${r.line ? `:${r.approx ? '~' : ''}${r.line}` : ''}` : '';
      lines.push(`  - \`${r.selector}\`${r.media ? ` @media ${r.media}` : ''}${where} { ${r.declarations.map((d) => `${d.name}: ${d.value}${d.important ? ' !important' : ''}`).join('; ')} }${r.wins?.length ? ` wins: ${r.wins.join(', ')}` : ''}`);
    }
  }
  const tokens = Object.entries(el.tokens || {});
  if (tokens.length) lines.push(`- Design tokens behind the current values: ${tokens.map(([prop, t]) => `${prop} = \`${t}\``).join(', ')}`);
  const c = el.component;
  if (c?.name) {
    const props = Object.entries(c.props || {});
    lines.push(`- Component: \`<${c.name}>\`${props.length ? ` with props ${props.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`);
    if (c.uses > 1) {
      const where = `used ${c.uses} times in ${c.fileCount || c.files?.length || '?'} file(s)${c.files?.length ? `, e.g. ${c.files.slice(0, 4).join(', ')}` : ''}`;
      if (a.scope === 'instance') lines.push(`- Scope: ONLY this instance. \`<${c.name}>\` is ${where}; the others must look the same as before. Change the call site (props, className, a new variant) rather than the component's shared styles.`);
      else if (a.scope === 'component') lines.push(`- Scope: ALL uses. Change \`<${c.name}>\` itself; it is ${where}, and every one of them should get this change.`);
      else lines.push(`- Scope: not specified. \`<${c.name}>\` is ${where}. Decide from the note whether this is about this one instance or the component everywhere, and say which you chose in your summary.`);
    }
  }
  return lines;
}

function fmtStep(s) {
  const target = s.selector ? `\`${s.selector}\`${s.text ? ` ("${s.text}")` : ''}` : '';
  if (s.type === 'click') return `Click ${target}`;
  if (s.type === 'fill') return `Type ${s.secret ? '(a password)' : JSON.stringify(s.value)} into ${target}`;
  if (s.type === 'check') return `Set ${target} to ${s.value === 'true' ? 'checked' : 'unchecked'}`;
  if (s.type === 'key') return `Press ${s.key}`;
  if (s.type === 'navigate') return `The page went to ${s.url}`;
  return s.type;
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
    lines.push(...describeElementExtras(a));
    if (el.html) lines.push('- Rendered HTML (truncated):\n```html\n' + el.html + '\n```');
    if (a.imageFile) lines.push(`- Close-up screenshot: ${a.imageFile}`);
  } else if (a.kind === 'drawing') {
    lines.push(`### [${a.n}] Markup drawn on the page: ${note}`);
    lines.push(`- Screenshot of the page with the user's markup on top: ${a.imageFile}`);
    if (a.region) lines.push(`- The markup covers roughly x ${a.region.x}–${a.region.x + a.region.width}, y ${a.region.y}–${a.region.y + a.region.height} (CSS px, viewport ${a.viewport?.width}×${a.viewport?.height}).`);
    if (a.hits?.length) {
      lines.push('- Elements under the markup (innermost first):');
      for (const h of a.hits) lines.push(describeHit(h));
    }
  } else if (a.kind === 'flow') {
    lines.push(`### [${a.n}] Recorded interaction: ${note}`);
    lines.push(`- The user did this in the page${a.startUrl ? ` (starting at ${a.startUrl})` : ''}:`);
    (a.steps || []).forEach((s, i) => lines.push(`  ${i + 1}. ${fmtStep(s)}`));
    lines.push('- The request is about what happens during or after these steps. Follow the same path through the code to find it.');
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
  if (d.a11y?.length) {
    out.push('Accessibility violations (axe-core, WCAG A/AA):');
    for (const v of d.a11y) {
      out.push(`- [${v.impact || 'issue'}] ${v.help} (${v.id}, ${v.count} element${v.count > 1 ? 's' : ''})`);
      for (const n of v.nodes) out.push(`  - \`${n.target}\`: ${n.summary}`);
    }
  }
  if (d.devLog?.trim()) {
    out.push('Dev server output (tail):');
    out.push('```');
    out.push(d.devLog.trim());
    out.push('```');
  }
  return out.length ? out.join('\n') : null;
}

// What Pinpoint detected about the project's styling, so edits reuse it.
function fmtDesignSystem(ds) {
  if (!ds) return [];
  const out = ['## Design system (detected in the project)'];
  if (ds.tailwind) out.push(`- Tailwind CSS${ds.tailwind.version ? ` ${ds.tailwind.version}` : ''}${ds.tailwind.config ? ` (theme in ${ds.tailwind.config})` : ''}: style with utilities from the theme scale, not arbitrary values.`);
  if (ds.libraries.length) out.push(`- Component library: ${ds.libraries.join(', ')}${ds.componentsConfig ? ` (${ds.componentsConfig})` : ''}. Use and extend its components and variants before writing new ones.`);
  if (ds.styling.length) out.push(`- Styling: ${ds.styling.join(', ')}`);
  if (ds.tokenFiles.length) out.push(`- CSS-variable tokens are defined in: ${ds.tokenFiles.map((f) => `${f.file} (${f.count})`).join(', ')}`);
  if (ds.tokens.length) out.push(`- Tokens: ${ds.tokens.slice(0, 80).map((t) => `${t.name}: ${t.value}`).join('; ')}${ds.tokens.length > 80 ? '; …' : ''}`);
  out.push('- Rule: express colors, spacing, radii, type and shadows with these tokens/utilities. If a requested value has no exact token, use the nearest one and say so; add a new token only when the user asks for a value the system clearly lacks.');
  return out;
}

// Project context that rides along with every request (first turn and follow-ups).
function contextSections({ design, memory, diagnostics, route, env, designSystem }) {
  const out = [];
  if (route?.file) out.push(`Current route: ${route.path} (rendered by ${route.file}${route.framework ? `, ${route.framework}` : ''})`, '');
  const emulated = [];
  if (env?.colorScheme) emulated.push(`prefers-color-scheme: ${env.colorScheme} (the user is looking at the ${env.colorScheme} theme, so the request is about that theme unless they say otherwise; keep the other theme intact)`);
  if (env?.reducedMotion) emulated.push('prefers-reduced-motion: reduce (the request is about the reduced-motion experience)');
  if (env?.frozen) emulated.push('the page is frozen with transient UI (a menu, tooltip, popover or modal) held open, so some annotated elements only exist while that UI is open');
  if (env?.profile) emulated.push(`viewing as the "${env.profile.name}" profile${env.profile.detail ? ` (${env.profile.detail})` : ''}: what is on screen is what that user sees`);
  if (env?.states?.length) emulated.push(`simulated conditions, switched on by the user to test the layout: ${env.states.join('; ')}. The page is meant to cope with these; don't "fix" the simulated content itself`);
  if (emulated.length) out.push('Page state when the user sent this:', ...emulated.map((l) => `- ${l}`), '');
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
  const ds = fmtDesignSystem(designSystem);
  if (ds.length) out.push('', ...ds);
  return out;
}

// "Try it N ways": each variant is its own run; the previous one is reverted first.
function variantNote(v) {
  if (!v) return [];
  const out = [`## Variant ${v.index} of ${v.total}`];
  if (v.index === 1) out.push(`The user wants to see ${v.total} different takes on this request and pick one. This is the first. Make a complete, working version; the next variants will be asked for separately.`);
  else out.push(`Your previous variant was saved and its files have been restored to how they were before it, so the project is back at the starting point (re-read files before editing). Now do the same request again as variant ${v.index}: a clearly different design direction from the earlier one${v.index > 2 ? 's' : ''} (different layout, emphasis or styling choices, not a small tweak), still within the project's design system.`);
  out.push("End your summary with one line describing what makes this variant distinct.");
  return out;
}

const REMEMBER_RULE = 'If the user states a lasting preference for this project ("always…", "never…", "from now on…", a brand rule), end your reply with one line exactly like `REMEMBER: <the rule in one short sentence>`. Otherwise don\'t add that line.';

function buildPrompt({ request, files, projectDir, followUp, design, memory, designSystem }) {
  const { url, title, viewport, breakpoints, instruction, annotations, diagnostics, route, env, variant, note } = request;
  const hasAnn = annotations.length > 0;
  const empty = isEmptyProject(projectDir);
  // DESIGN.md and the detected design system go in once per session; memory and diagnostics every turn.
  const ctx = contextSections({ design: followUp ? '' : design, memory, diagnostics, route, env, designSystem: followUp ? null : designSystem });
  const variantLines = variantNote(variant);

  if (followUp && !hasAnn) {
    return [
      ...(note ? [note, ''] : []),
      ...(variantLines.length ? [...variantLines, ''] : []),
      instruction?.trim() || (variant ? '(Same request as before.)' : 'Continue.'),
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
  if (viewport?.responsive) {
    out.push(`- The user is in responsive mode at ${viewport.width}px wide, so this request (including any live tweaks) is about the layout at this width. Put the change in the breakpoint / responsive variant that applies here and leave other widths as they are, unless they ask for it everywhere.`);
    if (breakpoints?.length) out.push(`- Breakpoints in the page's CSS: ${breakpoints.map((b) => `${b.kind}-width ${b.px}px${(b.kind === 'min' ? viewport.width >= b.px : viewport.width <= b.px) ? ' (active)' : ''}`).join(', ')}`);
  }
  if (files.overview) out.push(`- Full viewport screenshot with numbered markers matching the annotations below: ${files.overview}`);
  if (empty) out.push('- The project folder is empty: create the page from scratch (a self-contained `index.html` unless the user asks for a framework).');
  out.push('');

  if (note) { out.push(note); out.push(''); }
  if (variantLines.length) { out.push(...variantLines); out.push(''); }

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
      // The user can annotate several pages (browser tabs) in one request.
      if (a.pageUrl && a.pageUrl !== url) out.push(`- This annotation is on a different page than the one above: ${a.pageUrl}`);
      out.push('');
    }
  }

  out.push('## How to work');
  out.push('1. Look at the screenshots first. They are attached to this message (the paths above are the same files) and show exactly what the user sees and marked up.');
  out.push('2. Find the source that renders each annotated element. Start from the source hint if there is one; otherwise search for distinctive visible text, class names or ids from the rendered HTML. The rendered HTML is compiled output: map it back to the component/template that produces it, and do not edit build output.');
  out.push("3. Read the user's markup this way: arrows mean move or point to; circles or boxes mean focus on this; a cross or scribble means remove; handwritten words are instructions. The pen color is only markup, not a color the user wants, unless the note says so.");
  out.push('4. Make focused edits that do exactly what was asked. Follow the conventions already in the codebase (styling approach, design tokens, component patterns). Don\'t refactor unrelated code.');
  out.push(request.background
    ? '5. You are working in a separate copy of the project so the user can keep working in theirs. No dev server is running here; don\'t start one or run builds. Make the edits and finish.'
    : '5. The dev server is already running with hot reload, so don\'t start servers or run production builds. Run a quick type check or lint only if it is cheap.');
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

// The automatic check after a run: the agent looks at what its change actually
// rendered and at errors that appeared since, and fixes what's off.
function buildVerifyPrompt({ request }) {
  const { verify, diagnostics, url } = request;
  const out = ['[Automatic check from Pinpoint, not a message from the user.]', ''];
  out.push(`Your changes have hot-reloaded. This is how ${url} renders now:`);
  out.push(`- After your changes: ${verify.afterFile}`);
  if (verify.beforeFile) out.push(`- Before your changes: ${verify.beforeFile}`);
  out.push('(Both screenshots are attached.)', '');
  if (verify.same) out.push('IMPORTANT: the two screenshots are pixel-for-pixel identical. Your edit made no visible difference on this page. Unless the request was about something that cannot be seen (a refactor, an invisible attribute), work out why and fix it: the wrong file or selector, a rule overridden by a more specific one, a change that only applies in another state or breakpoint, or a build that did not pick the file up.', '');
  const diag = fmtDiagnostics(diagnostics);
  if (diag) out.push('Problems reported by the page since your changes:', diag, '');
  out.push('Check your work against what the user asked for:');
  out.push('1. Does the "after" screenshot show the change they wanted, in the place they pointed at?');
  out.push('2. Did anything else on the page break or shift that should not have (compare with "before")?');
  out.push(`3. ${diag ? 'Are the problems above caused by your changes?' : 'No new console or network errors were reported.'}`);
  out.push('');
  out.push('If something is wrong, fix it now and say in one or two sentences what you fixed. If it all looks right, reply with one short sentence saying so and change nothing. Do not make improvements nobody asked for.');
  return out.join('\n');
}

module.exports = { buildPrompt, buildSteerPrompt, buildVerifyPrompt };
