const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');

const fail = (reason) => { throw new Error(reason); };

function parse(code, file) {
  return parser.parse(code, {
    sourceType: 'module', errorRecovery: true,
    plugins: ['jsx', ...(/\.tsx?$/.test(file) ? ['typescript'] : []), 'decorators-legacy'],
  });
}

function walk(node, visit, parent = null) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walk(c, visit, node);
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

const tagName = (el) => {
  const n = el.openingElement.name;
  return n.type === 'JSXIdentifier' ? n.name : n.type === 'JSXMemberExpression' ? n.property.name : '';
};

function findElement(ast, { line, column, tag }) {
  const found = [];
  walk(ast, (n, parent) => { if (n.type === 'JSXElement') found.push({ el: n, parent }); });
  const score = (f) => {
    const s = f.el.openingElement.loc.start;
    const sameTag = tag && tagName(f.el).toLowerCase() === tag ? 0 : 1;
    return Math.abs(s.line - line) * 1000 + sameTag * 100 + Math.abs(s.column + 1 - (column || s.column + 1));
  };
  const near = found.filter((f) => Math.abs(f.el.openingElement.loc.start.line - line) <= 1).sort((a, b) => score(a) - score(b));
  return near[0] || null;
}

const SCALE = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);
const arb = (v) => `[${v.trim().replace(/\s+/g, '_')}]`;
function space(v) {
  if (/^0(px)?$/.test(v)) return '0';
  const m = v.match(/^(-?[\d.]+)px$/);
  if (m && SCALE.has(Math.abs(+m[1]) / 4)) return String(Math.abs(+m[1]) / 4);
  return arb(v.replace(/^-/, ''));
}
function box(prefix, value) {
  const p = value.trim().split(/\s+/);
  const one = (side, v) => `${v.startsWith('-') ? '-' : ''}${prefix}${side}-${space(v)}`;
  if (p.length === 1) return [one('', p[0])];
  if (p.length === 2) return [one('y', p[0]), one('x', p[1])];
  if (p.length === 3) return [one('t', p[0]), one('x', p[1]), one('b', p[2])];
  return [one('t', p[0]), one('r', p[1]), one('b', p[2]), one('l', p[3])];
}
const WEIGHTS = { 100: 'thin', 200: 'extralight', 300: 'light', 400: 'normal', 500: 'medium', 600: 'semibold', 700: 'bold', 800: 'extrabold', 900: 'black' };
const TEXT_SIZE = /^text-(xs|sm|base|lg|[2-9]?xl|\[-?[\d.]+(px|rem|em|%)\])$/;
const TEXT_OTHER = /^text-(left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$/;

function colorName(value, tokens) {
  const hit = (tokens || []).find((t) => t.name.startsWith('--color-') && t.value.toLowerCase() === value.toLowerCase());
  return hit ? hit.name.slice('--color-'.length) : null;
}

function utility(prop, value, tokens) {
  const v = value.trim();
  switch (prop) {
    case 'padding': return { add: box('p', v), drop: (c) => /^-?p[xytrblse]?-/.test(c) };
    case 'margin': return { add: box('m', v), drop: (c) => /^-?m[xytrblse]?-/.test(c) };
    case 'gap': return { add: [`gap-${space(v.split(/\s+/)[0])}`], drop: (c) => /^gap(-[xy])?-/.test(c) };
    case 'border-radius': return { add: [/^0(px)?$/.test(v) ? 'rounded-none' : `rounded-${arb(v)}`], drop: (c) => /^rounded($|-)/.test(c) };
    case 'font-size': return { add: [`text-${arb(v)}`], drop: (c) => TEXT_SIZE.test(c) };
    case 'font-weight': return { add: [`font-${WEIGHTS[v] || arb(v)}`], drop: (c) => /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/.test(c) };
    case 'line-height': return { add: [`leading-${arb(v)}`], drop: (c) => /^leading-/.test(c) };
    case 'opacity': { const n = Math.round(parseFloat(v) * 100); return { add: [n % 5 === 0 ? `opacity-${n}` : `opacity-${arb(v)}`], drop: (c) => /^opacity-/.test(c) }; }
    case 'color': return { add: [`text-${colorName(v, tokens) || arb(v)}`], drop: (c) => /^text-/.test(c) && !TEXT_SIZE.test(c) && !TEXT_OTHER.test(c) };
    case 'background-color': return { add: [`bg-${colorName(v, tokens) || arb(v)}`], drop: (c) => /^bg-/.test(c) && !/^bg-(gradient|none|cover|contain|center|top|bottom|left|right|fixed|local|scroll|clip|origin|repeat|no-repeat|blend|linear|radial|conic|\[url)/.test(c) };
    case 'width': return { add: [`w-${arb(v)}`], drop: (c) => /^w-/.test(c) };
    case 'height': return { add: [`h-${arb(v)}`], drop: (c) => /^h-/.test(c) };
    default: return null;
  }
}

const jsxText = (s) => (/[{}<>]/.test(s) ? `{${JSON.stringify(s)}}` : s);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

function textSplice(code, el, from, to) {
  const want = squash(from);
  for (const child of el.children) {
    if (child.type === 'JSXText' && squash(child.value) === want) {
      const raw = code.slice(child.start, child.end);
      return { start: child.start, end: child.end, text: raw.match(/^\s*/)[0] + jsxText(to) + raw.match(/\s*$/)[0] };
    }
    if (child.type === 'JSXExpressionContainer' && child.expression.type === 'StringLiteral' && squash(child.expression.value) === want) {
      return { start: child.expression.start, end: child.expression.end, text: JSON.stringify(to) };
    }
  }
  fail("This text isn't written in the component as plain text (it comes from a variable, a prop or a translation), so it can't be replaced directly.");
}

function classPieces(attrValue) {
  const pieces = [];
  walk(attrValue, (n) => {
    if (n.type === 'StringLiteral') pieces.push({ start: n.start + 1, end: n.end - 1, value: n.value });
    else if (n.type === 'TemplateElement') pieces.push({ start: n.start, end: n.end, value: n.value.raw });
  });
  return pieces;
}

function classSplices(code, el, drop, add) {
  const opening = el.openingElement;
  const attr = opening.attributes.find((a) => a.type === 'JSXAttribute' && (a.name.name === 'className' || a.name.name === 'class'));
  if (!attr || !attr.value) {
    if (!add.length) return [];
    const at = attr ? attr.end : opening.name.end;
    return attr ? [{ start: attr.start, end: attr.end, text: `${attr.name.name}="${add.join(' ')}"` }] : [{ start: at, end: at, text: ` className="${add.join(' ')}"` }];
  }
  const pieces = classPieces(attr.value);
  if (!pieces.length) fail('The class list is built entirely in code here, so there is no literal to edit.');
  const out = [];
  let appended = false;
  for (const piece of pieces) {
    const names = piece.value.split(/\s+/).filter(Boolean);
    const kept = names.filter((n) => n.includes(':') || !drop(n));
    const next = !appended ? [...kept, ...add.filter((a) => !kept.includes(a))] : kept;
    appended = true;
    if (next.join(' ') !== names.join(' ')) {
      const lead = piece.value.match(/^\s*/)[0], trail = piece.value.match(/\s*$/)[0];
      out.push({ start: piece.start, end: piece.end, text: lead + next.join(' ') + trail });
    }
  }
  return out;
}

function classEditSplices(code, el, from, to) {
  const before = from.split(/\s+/).filter(Boolean), after = to.split(/\s+/).filter(Boolean);
  const removed = new Set(before.filter((c) => !after.includes(c)));
  const added = after.filter((c) => !before.includes(c));
  const attr = el.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && (a.name.name === 'className' || a.name.name === 'class'));
  if (removed.size) {
    const literal = new Set(attr?.value ? classPieces(attr.value).flatMap((p) => p.value.split(/\s+/)) : []);
    const missing = [...removed].filter((c) => !literal.has(c));
    if (missing.length) fail(`"${missing.join(' ')}" isn't written on this element (it is added in code or by the component), so it can't be removed directly.`);
  }
  const pieces = attr?.value ? classPieces(attr.value) : [];
  if (attr?.value && !pieces.length) fail('The class list is built entirely in code here, so there is no literal to edit.');
  if (!attr || !attr.value) return classSplices(code, el, () => false, added);
  const out = [];
  pieces.forEach((piece, i) => {
    const names = piece.value.split(/\s+/).filter(Boolean);
    const next = [...names.filter((n) => !removed.has(n)), ...(i === 0 ? added.filter((a) => !names.includes(a)) : [])];
    if (next.join(' ') !== names.join(' ')) {
      const lead = piece.value.match(/^\s*/)[0], trail = piece.value.match(/\s*$/)[0];
      out.push({ start: piece.start, end: piece.end, text: lead + next.join(' ') + trail });
    }
  });
  return out;
}

function reorderSplices(code, found, reorder) {
  const parent = found.parent;
  if (!parent || parent.type !== 'JSXElement') fail('This element is not written directly inside its parent in the source (it comes from a loop or another component), so it cannot be moved directly.');
  const kids = parent.children.filter((c) => c.type === 'JSXElement' || c.type === 'JSXFragment' || (c.type === 'JSXExpressionContainer' && c.expression.type !== 'JSXEmptyExpression') || (c.type === 'JSXText' && c.value.trim()));
  if (kids.some((c) => c.type !== 'JSXElement') || kids.length !== reorder.count) fail('The siblings here are produced by code (a loop or a condition), so the order cannot be changed directly.');
  const from = kids.indexOf(found.el);
  if (from !== reorder.from) fail("The element's position in the source doesn't match the page, so it was not moved.");
  const order = kids.map((k) => code.slice(k.start, k.end));
  const [moved] = order.splice(from, 1);
  order.splice(reorder.to, 0, moved);
  return kids.map((k, i) => ({ start: k.start, end: k.end, text: order[i] })).filter((s, i) => s.text !== code.slice(kids[i].start, kids[i].end));
}

function cssEdit(css, rule, changes) {
  const lines = css.split('\n');
  let offset = 0;
  for (let i = 0; i < rule.line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
  const open = css.indexOf('{', offset);
  if (open < 0) fail("Couldn't find that rule in its stylesheet.");
  let depth = 1, close = open + 1;
  for (; close < css.length && depth; close++) { if (css[close] === '{') depth++; else if (css[close] === '}') depth--; }
  close--;
  let body = css.slice(open + 1, close);
  for (const [prop, value] of changes) {
    const re = new RegExp(`(^|[;{\\s])(${prop.replace(/[-]/g, '\\-')}\\s*:\\s*)([^;}]*?)(\\s*)(?=[;}]|$)`, 'm');
    if (re.test(body)) body = body.replace(re, (_m, pre, key, old, trail) => `${pre}${key}${value}${/!important/.test(old) ? ' !important' : ''}${trail}`);
    else {
      const indent = (body.match(/\n([ \t]+)\S/) || [])[1] ?? '  ';
      const inline = !body.includes('\n');
      body = inline ? `${body.replace(/\s*$/, '')}${/[;{]\s*$/.test(body.trimEnd()) || !body.trim() ? '' : ';'} ${prop}: ${value}; ` : `${body.replace(/\s*$/, '')}${/;\s*$/.test(body.trimEnd()) ? '' : ';'}\n${indent}${prop}: ${value};\n`;
    }
  }
  return css.slice(0, open + 1) + body + css.slice(close);
}

function applySplices(code, splices) {
  let out = code;
  for (const s of [...splices].sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.text + out.slice(s.end);
  return out;
}

function resolveIn(root, file) {
  if (!file) return null;
  const abs = path.isAbsolute(file) || /^[a-zA-Z]:/.test(file) ? path.normalize(file) : path.join(root, file);
  if (!path.resolve(abs).toLowerCase().startsWith(path.resolve(root).toLowerCase() + path.sep)) return null;
  return fs.existsSync(abs) ? abs : null;
}

function prepare(root, ann, ctx = {}) {
  const el = ann.element;
  if (!el) fail('Only a picked element can be edited directly.');
  const tweaks = Object.entries(ann.tweaks || {});
  if (!tweaks.length && !ann.textEdit && !ann.classEdit && !ann.reorder) fail('Nothing to apply yet: change a style, the text, the classes or the order first.');
  if (ann.propEdits) fail('Prop changes are made where the component is used; the agent handles those.');
  if (ann.states?.length) fail('A change for a :hover / :focus state needs the agent: it goes into a state rule or variant, not the base style.');

  const writes = new Map();
  const summary = [];
  const read = (abs) => writes.get(abs) ?? fs.readFileSync(abs, 'utf8');
  const rel = (abs) => path.relative(root, abs).split(path.sep).join('/');

  const src = resolveIn(root, el.source?.file);
  const isJsx = !!src && /\.[jt]sx$/.test(src) && !!el.source.line;
  let found = null;
  if (isJsx) {
    found = findElement(parse(read(src), src), { line: el.source.line, column: el.source.column, tag: el.tag });
    if (!found) fail(`Couldn't find this <${el.tag}> at ${rel(src)}:${el.source.line}.`);
  }
  const needJsx = (what) => { if (!found) fail(`${what} needs the element's source line, which is only known for React components in a dev build. The agent can still do it.`); };

  const splices = [];
  if (ann.textEdit) { needJsx('Editing text'); splices.push(textSplice(read(src), found.el, ann.textEdit.from, ann.textEdit.to)); summary.push(`text → "${ann.textEdit.to}"`); }
  if (ann.classEdit) { needJsx('Editing classes'); splices.push(...classEditSplices(read(src), found.el, ann.classEdit.from, ann.classEdit.to)); summary.push('class list updated'); }
  if (ann.reorder) { needJsx('Moving an element'); splices.push(...reorderSplices(read(src), found, ann.reorder)); summary.push(`moved to position ${ann.reorder.to + 1}`); }

  if (tweaks.length) {
    const asClasses = ctx.tailwind && found ? tweaks.map(([p, v]) => [p, utility(p, v, ctx.tokens)]) : null;
    if (asClasses && asClasses.every(([, u]) => u)) {
      const all = asClasses.map(([, u]) => u);
      splices.push(...classSplices(read(src), found.el, (c) => all.some((u) => u.drop(c)), all.flatMap((u) => u.add)));
      summary.push(...all.map((u) => u.add.join(' ')));
    } else {
      const byRule = new Map();
      for (const [prop, value] of tweaks) {
        const rule = (el.rules || []).find((r) => r.wins?.includes(prop) && r.file && r.line && !r.approx && !r.utility && /\.css$/.test(r.file))
          || (el.rules || []).find((r) => r.file && r.line && !r.approx && !r.utility && /\.css$/.test(r.file) && !r.media);
        if (!rule) fail(ctx.tailwind ? "This element's classes can't be edited directly here." : `No stylesheet rule to put "${prop}" in was found (styles come from a preprocessor, CSS-in-JS or generated classes). The agent can still do it.`);
        const key = `${rule.file}:${rule.line}`;
        if (!byRule.has(key)) byRule.set(key, { rule, changes: [] });
        byRule.get(key).changes.push([prop, value]);
      }
      for (const { rule, changes } of byRule.values()) {
        const abs = resolveIn(root, rule.file);
        if (!abs) fail(`${rule.file} isn't a file in this project.`);
        writes.set(abs, cssEdit(read(abs), rule, changes));
        summary.push(`${rule.selector} { ${changes.map(([p, v]) => `${p}: ${v}`).join('; ')} } in ${rel(abs)}`);
      }
    }
  }
  if (splices.length) writes.set(src, applySplices(read(src), splices));
  for (const [abs, content] of [...writes]) if (content === fs.readFileSync(abs, 'utf8')) writes.delete(abs);
  if (!writes.size) fail('The source already says that; nothing to change.');
  return { writes, summary, files: [...writes.keys()].map(rel) };
}

module.exports = { prepare, utility, findElement, parse, walk };
