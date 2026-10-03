// Unit checks for the instant-edit engine and component discovery (plain node).
const OUT = process.env.PP_OUT || __dirname;         // where results, screenshots and built helpers go
const FIX = process.env.PP_FIXTURES || __dirname;    // real projects some suites run against
const fs = require('fs'), os = require('os'), path = require('path');
const repo = process.cwd();
const inst = require(path.join(repo, 'electron', 'instant.cjs'));
const comps = require(path.join(repo, 'electron', 'components.cjs'));
let pass = 0, failed = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
fs.mkdirSync(path.join(d, 'src'));
const f = path.join(d, 'src', 'Card.tsx');
const SRC = [
  'import { cn } from "./cn";',
  'type Props = { title: string; size?: "sm" | "md" | "lg"; featured?: boolean; count?: number; children?: React.ReactNode; onClick?: () => void };',
  'export function Card({ title, size = "md", featured = false, count, children }: Props) {',
  '  return (',
  '    <div className="card p-2 text-sm hover:p-8 bg-white">',
  '      <h2 className={cn("title text-lg", featured && "font-bold")}>Summer sale</h2>',
  '      <p>First</p>',
  '      <span>Second</span>',
  '      <button>Buy now</button>',
  '      <i>{title}</i>',
  '    </div>',
  '  );',
  '}',
  'export default function Page() { return <Card title="x" />; }',
].join('\n');
const reset = () => { fs.writeFileSync(f, SRC); fs.writeFileSync(path.join(d, 'src', 'app.css'), '.card {\n  padding: 8px;\n  color: red;\n}\n.one { margin: 0 }\n'); };
const el = (line, tag, extra = {}) => ({ tag, source: { file: f, line, column: 5 }, ...extra });
const lineOf = (r, n) => [...r.writes.values()][0].split('\n')[n - 1].trim();
const why = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
reset();

let r = inst.prepare(d, { element: el(5, 'div'), tweaks: { padding: '16px 18px', 'background-color': '#ff00aa', 'font-weight': '600', 'font-size': '18px' } }, { tailwind: true, tokens: [{ name: '--color-brand', value: '#ff00aa' }] });
check('tailwind: tweaks become utilities, replacing the ones they override, keeping variants', lineOf(r, 5) === '<div className="card hover:p-8 py-4 px-[18px] bg-brand font-semibold text-[18px]">', lineOf(r, 5));

r = inst.prepare(d, { element: el(6, 'h2'), textEdit: { from: 'Summer sale', to: 'Winter sale' } }, {});
check('text edit', lineOf(r, 6).endsWith('>Winter sale</h2>'), lineOf(r, 6));
r = inst.prepare(d, { element: el(6, 'h2'), textEdit: { from: 'Summer sale', to: 'A {b}' } }, {});
check('text with braces is written as an expression', lineOf(r, 6).endsWith('>{"A {b}"}</h2>'), lineOf(r, 6));
check('text from a variable is refused', /isn't written in the component as plain text/.test(why(() => inst.prepare(d, { element: el(10, 'i'), textEdit: { from: 'x', to: 'y' } }, {}))));

r = inst.prepare(d, { element: el(6, 'h2'), classEdit: { from: 'title text-lg', to: 'title text-xl underline' } }, {});
check('class edit inside cn()', lineOf(r, 6).startsWith('<h2 className={cn("title text-xl underline", featured && "font-bold")}>'), lineOf(r, 6));
check('removing a class that is not literal is refused', /isn't written on this element/.test(why(() => inst.prepare(d, { element: el(6, 'h2'), classEdit: { from: 'title computed', to: 'title' } }, {}))));
r = inst.prepare(d, { element: el(7, 'p'), classEdit: { from: '', to: 'lead' } }, {});
check('class added where there was no className', lineOf(r, 7) === '<p className="lead">First</p>', lineOf(r, 7));

r = inst.prepare(d, { element: el(7, 'p'), reorder: { from: 1, to: 3, count: 5 } }, {});
const body = [...r.writes.values()][0].split('\n').slice(5, 10).map((l) => l.trim().replace(/<\/?(\w+).*/, '$1')).join(',');
check('reorder moves the element among its siblings', body === 'h2,span,button,p,i', body);
check('reorder refuses a mismatched sibling count', /produced by code/.test(why(() => inst.prepare(d, { element: el(7, 'p'), reorder: { from: 1, to: 2, count: 9 } }, {}))));

r = inst.prepare(d, { element: { tag: 'div', rules: [{ selector: '.card', file: 'src/app.css', line: 1, wins: ['padding', 'color'], declarations: [] }] }, tweaks: { padding: '20px', gap: '4px' } }, {});
check('css rule: value replaced, new declaration added', [...r.writes.values()][0].startsWith('.card {\n  padding: 20px;\n  color: red;\n  gap: 4px;\n}'), JSON.stringify([...r.writes.values()][0]));
r = inst.prepare(d, { element: { tag: 'div', rules: [{ selector: '.one', file: 'src/app.css', line: 5, wins: ['margin'], declarations: [] }] }, tweaks: { margin: '4px' } }, {});
check('css rule on one line', [...r.writes.values()][0].includes('.one { margin: 4px }'), JSON.stringify([...r.writes.values()][0]));
check('no usable rule is refused with a reason', /No stylesheet rule/.test(why(() => inst.prepare(d, { element: { tag: 'div', rules: [{ selector: '.x', file: 'a.scss', line: 3, approx: true, wins: ['padding'], declarations: [] }] }, tweaks: { padding: '1px' } }, {}))));
check('state changes are left to the agent', /state/.test(why(() => inst.prepare(d, { element: el(5, 'div'), states: ['hover'], tweaks: { padding: '1px' } }, { tailwind: true }))));
check('files outside the project are refused', /source line/.test(why(() => inst.prepare(d, { element: { tag: 'p', source: { file: path.join(os.tmpdir(), 'elsewhere.tsx'), line: 1 } }, textEdit: { from: 'a', to: 'b' } }, {}))));

const found = comps.scan(d);
const card = found.find((c) => c.name === 'Card');
const prop = (n) => card.props.find((p) => p.name === n);
check('components found with their export kind', found.length === 2 && card && !card.isDefault && found.find((c) => c.name === 'Page').isDefault, JSON.stringify(found.map((c) => c.name)));
check('prop types and defaults read from the source', prop('title').type === 'string' && prop('title').required && prop('size').type === 'enum' && prop('size').options.join() === 'sm,md,lg' && prop('size').default === 'md' && prop('featured').type === 'boolean' && prop('count').type === 'number' && prop('children').type === 'node' && !prop('onClick'), JSON.stringify(card.props));

console.log(`${pass} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
