// Finds the React components a project exports and what props they take, for
// the component workspace: render any of them alone, with controls for its
// props and a grid of its variants. No Storybook involved.
const fs = require('node:fs');
const path = require('node:path');
const { parse, walk } = require('./instant.cjs');

const SKIP = new Set(['node_modules', '.git', '.next', '.nuxt', '.svelte-kit', '.astro', 'dist', 'build', 'out', '.output', '.pinpoint', 'coverage', '.turbo', '.vercel', '.cache', 'public']);
const MAX_FILES = 600;
const MAX_BYTES = 200 * 1024;

function files(root) {
  const out = [];
  const stack = [''];
  while (stack.length && out.length < MAX_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name) && !e.name.startsWith('.')) stack.push(r); }
      else if (/\.(tsx|jsx)$/.test(e.name) && !/\.(test|spec|stories)\.\w+$/.test(e.name)) out.push(r);
    }
  }
  return out;
}

// A prop's type, reduced to what a control can be built for.
function propType(t) {
  if (!t) return { type: 'other' };
  if (t.type === 'TSParenthesizedType') return propType(t.typeAnnotation);
  if (t.type === 'TSStringKeyword') return { type: 'string' };
  if (t.type === 'TSNumberKeyword') return { type: 'number' };
  if (t.type === 'TSBooleanKeyword') return { type: 'boolean' };
  if (t.type === 'TSUnionType') {
    const parts = t.types.filter((x) => !['TSUndefinedKeyword', 'TSNullKeyword'].includes(x.type));
    const strings = parts.filter((x) => x.type === 'TSLiteralType' && x.literal.type === 'StringLiteral').map((x) => x.literal.value);
    if (strings.length && strings.length === parts.length) return { type: 'enum', options: strings };
    if (parts.length === 1) return propType(parts[0]);
    if (parts.every((x) => x.type === 'TSLiteralType' && x.literal.type === 'BooleanLiteral')) return { type: 'boolean' };
    return { type: 'other' };
  }
  if (t.type === 'TSTypeReference') {
    const name = t.typeName.name || t.typeName.right?.name || '';
    if (/^(ReactNode|ReactElement|JSX\.Element|Element)$/.test(name)) return { type: 'node' };
  }
  if (t.type === 'TSFunctionType') return { type: 'function' };
  return { type: 'other' };
}

function scanFile(root, rel) {
  let code;
  try { if (fs.statSync(path.join(root, rel)).size > MAX_BYTES) return []; code = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return []; }
  if (!/<[A-Za-z]/.test(code)) return [];
  let ast;
  try { ast = parse(code, rel); } catch { return []; }

  // Type declarations in this file, to resolve `props: ButtonProps`.
  const types = new Map();
  for (const node of ast.program.body) {
    const d = node.type === 'ExportNamedDeclaration' && node.declaration ? node.declaration : node;
    if (d.type === 'TSInterfaceDeclaration') types.set(d.id.name, d.body.body);
    else if (d.type === 'TSTypeAliasDeclaration' && d.typeAnnotation.type === 'TSTypeLiteral') types.set(d.id.name, d.typeAnnotation.members);
  }
  const members = (ann) => {
    const t = ann?.typeAnnotation?.typeAnnotation; // the annotation node wraps the type itself
    if (!t) return null;
    if (t.type === 'TSTypeLiteral') return t.members;
    if (t.type === 'TSTypeReference' && t.typeName.type === 'Identifier') return types.get(t.typeName.name) || null;
    return null;
  };
  const hasJsx = (fn) => { let yes = false; walk(fn, (n) => { if (n.type === 'JSXElement' || n.type === 'JSXFragment') yes = true; }); return yes; };

  // The function behind a declaration: plain, arrow, or wrapped in memo()/forwardRef().
  const unwrap = (init) => {
    if (!init) return null;
    if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression' || init.type === 'FunctionDeclaration') return init;
    if (init.type === 'CallExpression' && init.arguments[0]) return unwrap(init.arguments[0]);
    return null;
  };

  const describe = (name, fn, isDefault) => {
    if (!/^[A-Z]/.test(name) || !fn || !hasJsx(fn)) return null;
    const param = fn.params[0];
    const props = new Map();
    for (const m of members(param?.typeAnnotation ? param : param?.left?.typeAnnotation ? param.left : null) || []) {
      if (m.type !== 'TSPropertySignature' || m.key.type !== 'Identifier') continue;
      props.set(m.key.name, { name: m.key.name, required: !m.optional, ...propType(m.typeAnnotation?.typeAnnotation) });
    }
    const pattern = param?.type === 'ObjectPattern' ? param : param?.type === 'AssignmentPattern' && param.left.type === 'ObjectPattern' ? param.left : null;
    for (const p of pattern?.properties || []) {
      if (p.type !== 'ObjectProperty' || p.key.type !== 'Identifier') continue;
      const entry = props.get(p.key.name) || { name: p.key.name, required: false, type: 'other' };
      if (p.value.type === 'AssignmentPattern') {
        const d = p.value.right;
        if (d.type === 'StringLiteral' || d.type === 'NumericLiteral' || d.type === 'BooleanLiteral') {
          entry.default = d.value;
          if (entry.type === 'other') entry.type = typeof d.value;
        }
      }
      props.set(p.key.name, entry);
    }
    if (props.has('children') && props.get('children').type === 'other') props.get('children').type = 'node';
    return { name, file: rel, isDefault, props: [...props.values()].filter((p) => p.type !== 'function' && !/^(ref|key|className|style)$/.test(p.name)).slice(0, 14) };
  };

  const out = [];
  const locals = new Map(); // name -> function, for `export default Name` and `export { Name }`
  for (const node of ast.program.body) {
    if (node.type === 'FunctionDeclaration' && node.id) locals.set(node.id.name, node);
    if (node.type === 'VariableDeclaration') for (const d of node.declarations) if (d.id.type === 'Identifier') locals.set(d.id.name, unwrap(d.init));
  }
  for (const node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration') {
      const d = node.declaration;
      if (d?.type === 'FunctionDeclaration' && d.id) out.push(describe(d.id.name, d, false));
      else if (d?.type === 'VariableDeclaration') for (const v of d.declarations) if (v.id.type === 'Identifier') out.push(describe(v.id.name, unwrap(v.init), false));
      else for (const s of node.specifiers || []) if (s.type === 'ExportSpecifier' && s.exported.name !== 'default') out.push(describe(s.exported.name, locals.get(s.local.name), false));
    } else if (node.type === 'ExportDefaultDeclaration') {
      const d = node.declaration;
      const base = path.basename(rel).replace(/\.\w+$/, '');
      if (d.type === 'Identifier') out.push(describe(d.name, locals.get(d.name), true));
      else out.push(describe(d.id?.name || (/^[A-Z]/.test(base) ? base : 'Default'), unwrap(d), true));
    }
  }
  return out.filter(Boolean);
}

function scan(root) {
  if (!root) return [];
  const seen = new Set();
  const out = [];
  for (const rel of files(root)) {
    for (const c of scanFile(root, rel)) {
      const key = `${c.file}#${c.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { scan, scanFile };
