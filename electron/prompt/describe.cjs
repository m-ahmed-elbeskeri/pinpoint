const { NO_NOTE } = require('./rules.cjs');

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

function describeRule(r) {
  const at = r.file ? ` — ${r.file}${r.line ? `:${r.approx ? '~' : ''}${r.line}` : ''}` : '';
  const where = r.utility ? " — generated utility class: change the element's class list, not this rule" : at;
  const body = r.declarations.map((d) => `${d.name}: ${d.value}${d.important ? ' !important' : ''}`).join('; ');
  return `  - \`${r.selector}\`${r.media ? ` @media ${r.media}` : ''}${where} { ${body} }${r.wins?.length ? ` wins: ${r.wins.join(', ')}` : ''}`;
}

function describeScope(a, c) {
  const examples = c.files?.length ? `, e.g. ${c.files.slice(0, 4).join(', ')}` : '';
  const where = `used ${c.uses} times in ${c.fileCount || c.files?.length || '?'} file(s)${examples}`;
  if (a.scope === 'instance') {
    return [
      `- Scope: ONLY this instance. \`<${c.name}>\` is ${where}; the others must look the same as before.`,
      "Change the call site (props, className, a new variant) rather than the component's shared styles.",
    ].join(' ');
  }
  if (a.scope === 'component') return `- Scope: ALL uses. Change \`<${c.name}>\` itself; it is ${where}, and every one of them should get this change.`;
  return [
    `- Scope: not specified. \`<${c.name}>\` is ${where}.`,
    'Decide from the note whether this is about this one instance or the component everywhere, and say which you chose in your summary.',
  ].join(' ');
}

function describeElementExtras(a) {
  const el = a.element;
  const lines = [];
  if (a.states?.length) {
    const names = a.states.map((s) => STATE_LABEL[s] || s).join(' + ');
    lines.push([
      `- State: the user is looking at this element in its ${names} state.`,
      `The computed styles and close-up below were taken in that state, so the request is about how it looks then (e.g. its \`${STATE_LABEL[a.states[0]] || a.states[0]}\` rule or variant),`,
      'not its resting look, unless the note says otherwise.',
    ].join(' '));
  }
  const tweaks = Object.entries(a.tweaks || {});
  if (tweaks.length) {
    lines.push("- Live tweaks: the user adjusted these in the browser until it looked right. Make exactly these the element's styles in source (the overview screenshot shows them applied):");
    for (const [prop, value] of tweaks) {
      const was = el.styles?.[prop];
      lines.push(`  - \`${prop}\`: ${was ? `${was} → ` : ''}${value}`);
    }
    lines.push([
      "  Express each with the project's own tokens, utilities or scale where one matches (say so when you had to round to the nearest step);",
      'never leave them as inline styles unless the codebase already styles that way.',
    ].join(' '));
  }
  if (a.textEdit) {
    lines.push([
      `- Copy change: replace the text ${JSON.stringify(a.textEdit.from)} with ${JSON.stringify(a.textEdit.to)}.`,
      'Edit it where the copy lives (the component, or the content / i18n file it is read from).',
    ].join(' '));
  }
  if (a.classEdit) {
    const before = a.classEdit.from.split(/\s+/).filter(Boolean), after = a.classEdit.to.split(/\s+/).filter(Boolean);
    const added = after.filter((c) => !before.includes(c)), removed = before.filter((c) => !after.includes(c));
    lines.push(`- Class change (tried live in the browser):${added.length ? ` add \`${added.join(' ')}\`` : ''}${added.length && removed.length ? ';' : ''}${removed.length ? ` remove \`${removed.join(' ')}\`` : ''}. Apply it to this element's class list in source.`);
  }
  if (a.reorder) {
    const now = a.reorder.before ? ` (it now sits before ${a.reorder.before})` : ' (it is now last)';
    lines.push(`- Moved: the user dragged this element from position ${a.reorder.from + 1} to position ${a.reorder.to + 1} of ${a.reorder.count} among its siblings${now}. Make that the order in source.`);
  }
  const propEdits = Object.entries(a.propEdits || {});
  if (propEdits.length) {
    const changes = propEdits.map(([k, v]) => `${k} ${v.from} → ${v.to}`).join(', ');
    lines.push(`- Prop changes (tried live on \`<${el.component?.name || 'the component'}>\`): ${changes}. Make them at this element's call site.`);
  }
  if (el.rules?.length) {
    lines.push('- CSS rules that style it, most specific first ("wins" = properties this rule currently decides):');
    for (const r of el.rules) lines.push(describeRule(r));
  }
  const tokens = Object.entries(el.tokens || {});
  if (tokens.length) lines.push(`- Design tokens behind the current values: ${tokens.map(([prop, t]) => `${prop} = \`${t}\``).join(', ')}`);
  const c = el.component;
  if (c?.name) {
    const props = Object.entries(c.props || {});
    lines.push(`- Component: \`<${c.name}>\`${props.length ? ` with props ${props.map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}`);
    if (c.uses > 1) lines.push(describeScope(a, c));
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

const clipBody = (s, max = 4000) => {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max)}\n… (${t.length - max} more characters)` : t;
};

function describeSelected(a, note) {
  const el = a.element;
  const lines = [`### [${a.n}] Selected element: ${note}`];
  lines.push(`- Element: \`<${el.tag}${el.id ? ` id="${el.id}"` : ''}${el.classes?.length ? ` class="${el.classes.join(' ')}"` : ''}>\``);
  lines.push(`- CSS selector: \`${el.selector}\``);
  if (el.path) lines.push(`- DOM path: ${el.path}`);
  const src = fmtSource(el.source);
  if (src) lines.push(`- Source hint (from the framework's dev metadata): ${src}`);
  if (el.text) lines.push(`- Visible text: "${el.text}"`);
  lines.push(`- Rendered size: ${Math.round(el.rect.width)}×${Math.round(el.rect.height)}px at (${Math.round(el.rect.x)}, ${Math.round(el.rect.y)}) in the viewport`);
  if (!el.uid) {
    lines.push([
      `- This was picked by a reviewer in their own browser${a.viewport?.width ? `, ${a.viewport.width}px wide` : ''},`,
      'so there is no source hint or close-up and the selector was built from the page structure. Find the element from its text and HTML.',
    ].join(' '));
  }
  if (el.styles) lines.push(`- Computed styles: ${fmtStyles(el.styles)}`);
  lines.push(...describeElementExtras(a));
  if (el.html) lines.push('- Rendered HTML (truncated):\n```html\n' + el.html + '\n```');
  if (a.imageFile) lines.push(`- Close-up screenshot: ${a.imageFile}`);
  return lines;
}

function describeRequest(a, note) {
  const r = a.request;
  const lines = [`### [${a.n}] API request the page made: ${note}`];
  lines.push(`- Request: \`${r.method} ${r.url}\``);
  lines.push(`- Result: ${r.error && !r.status ? `failed before a response (${r.error})` : `status ${r.status}`}${r.ms != null ? ` in ${r.ms} ms` : ''}`);
  if (r.handler) lines.push(`- Handled by: ${r.handler.file}:${r.handler.line}${r.handler.sure ? '' : ' (best match on the end of the path; confirm it is mounted there)'}`);
  else lines.push('- No handler for this path was found in the project: it may be an external API, or a route registered in a way that could not be read.');
  if (r.reqBody) lines.push('- Body sent:\n```\n' + clipBody(r.reqBody) + '\n```');
  lines.push('- Response body:\n```\n' + (clipBody(r.resBody) || '(empty)') + '\n```');
  lines.push('- The request is about this endpoint or how the page uses its answer. Read the handler and the code that calls it before changing either.');
  return lines;
}

function describeAnnotation(a) {
  let lines = [];
  const note = a.note?.trim() ? a.note.trim() : NO_NOTE;

  if (a.kind === 'element') {
    lines = describeSelected(a, note);
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
    if (a.seen?.errors?.length) lines.push('- Console errors while the user did this:', ...a.seen.errors.map((x) => `  - ${x}`));
    if (a.seen?.failed?.length) lines.push('- Requests that failed while the user did this:', ...a.seen.failed.map((x) => `  - ${x}`));
    lines.push('- The request is about what happens during or after these steps. Follow the same path through the code to find it.');
    lines.push([
      '- Pinpoint replays these exact steps once you finish and shows the user whether they still run and whether errors come up,',
      'so keep the elements they click reachable the same way unless the request is to change them.',
    ].join(' '));
  } else if (a.kind === 'request' && a.request) {
    lines = describeRequest(a, note);
  } else if (a.kind === 'note') {
    lines.push(`### [${a.n}] Comment about the page as a whole: ${note}`);
    if (a.viewport?.width) lines.push(`- Written while looking at the page ${a.viewport.width}px wide.`);
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

module.exports = { describeAnnotation, clipBody };
