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

const runsLib = require(path.join(repo, 'electron', 'runs.cjs'));
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hunk-'));
  const dir = path.join(root, '.pinpoint', 'runs', 'r1');
  fs.mkdirSync(dir, { recursive: true });
  const lines = (edit) => Array.from({ length: 30 }, (_, i) => (edit[i] ? edit[i] : `line ${i}`)).join('\n') + '\n';
  const before = lines({}), after = lines({ 2: 'first change', 25: 'second change' });
  fs.writeFileSync(path.join(dir, '0.before'), before);
  fs.writeFileSync(path.join(dir, '0.after'), after);
  fs.writeFileSync(path.join(root, 'a.txt'), after);
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ changes: [{ i: 0, path: 'a.txt', kind: 'modify', hasBefore: true, hasAfter: true, binary: false, reverted: false }] }));
  let r = runsLib.revertHunk(root, 'r1', 'a.txt', 0);
  const now = fs.readFileSync(path.join(root, 'a.txt'), 'utf8');
  check('reverting one hunk undoes only that change', !now.includes('first change') && now.includes('second change') && !r.allReverted, now.slice(0, 40));
  check('and the diff then shows only the other one', !runsLib.diff(root, 'r1')[0].after.includes('first change') && runsLib.diff(root, 'r1')[0].after.includes('second change'));
  fs.writeFileSync(path.join(root, 'a.txt'), now.replace('second change', 'edited by hand'));
  r = runsLib.revertHunk(root, 'r1', 'a.txt', 0);
  check('a hunk edited since is reported, not overwritten', r.conflicts.includes('a.txt') && fs.readFileSync(path.join(root, 'a.txt'), 'utf8').includes('edited by hand'));
  fs.writeFileSync(path.join(root, 'a.txt'), now);
  r = runsLib.revertHunk(root, 'r1', 'a.txt', 0);
  check('reverting the last hunk restores the file and marks it reverted', fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === before && r.restored.includes('a.txt') && r.allReverted);
}

const { translate } = require(path.join(repo, 'electron', 'agent-generic.cjs'));
const { harnesses, splitArgs } = require(path.join(repo, 'electron', 'harnesses.cjs'));
const tr = (lines) => { const st = { sessionId: null, sawText: false }; return lines.flatMap((l) => translate(l, st) || [{ type: 'unknown' }]); };
const types = (evts) => evts.map((e) => e.type).join();
let ev = tr([{ type: 'init', session_id: 'g1', model: 'gemini' }, { type: 'message', role: 'assistant', content: 'Hi', delta: true }, { type: 'tool_use', tool_name: 'replace', tool_id: 't1', parameters: { file_path: 'a.css' } }, { type: 'tool_result', tool_id: 't1', status: 'success', output: 'ok' }, { type: 'result', status: 'success' }]);
check('gemini stream: session, text, tool and result', types(ev) === 'session,text_delta,tool,tool_result' && ev[2].detail === 'a.css', types(ev));
ev = tr([{ type: 'system', subtype: 'init', session_id: 'c1' }, { type: 'tool_call', subtype: 'started', call_id: 'k', tool_call: { readToolCall: { args: { path: 'x.ts' } } } }, { type: 'tool_call', subtype: 'completed', call_id: 'k', tool_call: { readToolCall: { args: { path: 'x.ts' }, result: { success: { content: 'abc' } } } } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } }]);
check('cursor stream: tool calls named and paired', types(ev) === 'session,tool,tool_result,text' && ev[1].name === 'Read' && ev[1].detail === 'x.ts' && ev[2].ok, types(ev));
ev = tr([{ type: 'tool_use', sessionID: 'o1', part: { type: 'tool', tool: 'edit', callID: 'e', state: { status: 'completed', input: { filePath: 'b.tsx' }, output: 'ok' } } }, { type: 'text', sessionID: 'o1', part: { type: 'text', text: 'Edited' } }]);
check('opencode stream: completed tool and text', types(ev) === 'session,tool,tool_result,text', types(ev));
ev = tr([{ type: 'result', is_error: true, result: 'quota' }]);
check('errors in a result are reported', ev[0].type === 'error' && ev[0].text === 'quota', JSON.stringify(ev));
check('unknown JSON is left for plain-text handling', translate({ hello: 1 }, { sessionId: null }) === null);
check('custom args: placeholders and quoting', JSON.stringify(harnesses({ customAgents: [{ id: 'x', name: 'X', command: 'x', args: 'run "a b" --m {model} {prompt}' }] }).find((h) => h.id === 'x').args({ prompt: 'P', model: 'M' })) === '["run","a b","--m","M","P"]' && splitArgs('').length === 0);
check('custom args without {prompt} get it appended', harnesses({ customAgents: [{ id: 'y', name: 'Y', command: 'y', args: '--json' }] }).find((h) => h.id === 'y').args({ prompt: 'P' }).join() === '--json,P');



// Branches and worktrees: switching parks uncommitted work per branch, compare shows what a PR would contain.
(async () => {
  const gitx = require(path.join(repo, 'electron', 'git.cjs'));
  const { execFileSync } = require('child_process');
  const top = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-git-'));
  const g = (...a) => execFileSync('git', a, { cwd: top, encoding: 'utf8' }).trim();
  const read = (n) => fs.readFileSync(path.join(top, n), 'utf8').replace(/\r\n/g, '\n');
  g('init', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(top, 'a.txt'), 'one\n'); g('add', '-A'); g('commit', '-m', 'first');
  g('switch', '-c', 'feature');
  fs.writeFileSync(path.join(top, 'a.txt'), 'one\ntwo\n'); g('commit', '-am', 'second');
  fs.writeFileSync(path.join(top, 'a.txt'), 'one\ntwo\nwip\n'); fs.writeFileSync(path.join(top, 'new.txt'), 'n\n');
  let r = await gitx.switchBranch(top, 'main');
  check('switching parks uncommitted work, untracked files included', r.parked === 2 && read('a.txt') === 'one\n' && !fs.existsSync(path.join(top, 'new.txt')), JSON.stringify(r));
  const listed = await gitx.branches(top);
  check('the branch list shows where work is parked', listed.branches.find((b) => b.name === 'feature')?.parked === 1 && listed.branches.find((b) => b.name === 'main')?.current, JSON.stringify(listed.branches));
  r = await gitx.switchBranch(top, 'feature');
  check('switching back brings the parked work back', r.restored && read('a.txt').endsWith('wip\n') && fs.existsSync(path.join(top, 'new.txt')) && !g('stash', 'list'), JSON.stringify(r));
  const c = await gitx.compare(top, { base: 'main', working: true });
  check('compare: commits and files against the base, uncommitted included', c.commits.length === 1 && c.files.map((x) => x.path).sort().join() === 'a.txt,new.txt' && c.files.find((x) => x.path === 'a.txt').before === 'one\n' && c.conflicts?.length === 0, JSON.stringify({ ...c, files: c.files.map((x) => x.path) }));
  const c2 = await gitx.compare(top, { base: 'main', working: false });
  check('compare: committed work only', c2.files.length === 1 && c2.files[0].after === 'one\ntwo\n', JSON.stringify(c2.files));
  g('add', '-A'); g('commit', '-m', 'wip');
  g('switch', 'main'); fs.writeFileSync(path.join(top, 'a.txt'), 'uno\n'); g('commit', '-am', 'clash'); g('switch', 'feature');
  const c3 = await gitx.compare(top, { base: 'main', working: false });
  check('compare: conflicts with the base are found', c3.conflicts?.join() === 'a.txt' && c3.behind === 1, JSON.stringify(c3.conflicts));
  const w = await gitx.addWorktree(top, { branch: 'side', create: true });
  check('a new branch can get its own worktree folder', fs.existsSync(path.join(w.open, 'a.txt')) && !!(await gitx.branches(top)).branches.find((b) => b.name === 'side')?.worktree, w.open);
  r = await gitx.switchBranch(top, 'side');
  check('a branch open in another worktree is opened there, not checked out twice', !!r.worktree && path.resolve(r.worktree) === path.resolve(w.open), JSON.stringify(r));
  await gitx.removeWorktree(top, w.open);
  check('removing a worktree keeps its branch', !fs.existsSync(w.open) && g('branch', '--list', 'side').includes('side'));

  // Against origin: publish, see what's new there, pull it, compare with the remote copy.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-origin-'));
  execFileSync('git', ['init', '-q', '--bare', bare]);
  g('remote', 'add', 'origin', bare);
  let st = await gitx.status(top);
  check('a branch that was never pushed is local only', !st.upstream && !st.gone, JSON.stringify(st));
  st = await gitx.push(top);
  check('publishing sets up tracking', st.upstream && st.upstreamName === 'origin/feature' && st.ahead === 0 && st.behind === 0, JSON.stringify(st));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-clone-'));
  execFileSync('git', ['clone', '-q', '-b', 'feature', bare, other]);
  const o = (...a) => execFileSync('git', a, { cwd: other, encoding: 'utf8' }).trim();
  o('config', 'user.email', 'o@o'); o('config', 'user.name', 'o');
  fs.writeFileSync(path.join(other, 'b.txt'), 'from elsewhere\n'); o('add', '-A'); o('commit', '-qm', 'teammate'); o('push', '-q');
  fs.writeFileSync(path.join(top, 'a.txt'), read('a.txt') + 'local wip\n');
  st = await gitx.fetchOrigin(top);
  check('fetching shows what is new on origin', st.behind === 1 && st.ahead === 0 && st.fetchedAt > Date.now() - 60000, JSON.stringify(st));
  const vs = await gitx.compare(top, { remote: true, working: true });
  check('compare with origin: what you would pull and your local edits', vs.remote && vs.incoming.length === 1 && vs.commits.length === 0 && vs.files.map((x) => x.path).join() === 'a.txt' && vs.incomingFiles.map((x) => x.path).join() === 'b.txt' && vs.incomingFiles[0].kind === 'add' && vs.conflicts?.length === 0, JSON.stringify({ ...vs, files: vs.files.map((x) => x.path) }));
  st = await gitx.pull(top);
  check('pulling fast-forwards and keeps uncommitted edits', st.behind === 0 && fs.existsSync(path.join(top, 'b.txt')) && read('a.txt').endsWith('local wip\n'), JSON.stringify(st));
  g('commit', '-qam', 'mine'); o('commit', '-qm', 'theirs', '--allow-empty'); o('push', '-q');
  await gitx.fetchOrigin(top);
  check('pushing is refused while origin has commits you lack', /Pull first/.test(await gitx.push(top).then(() => '', (e) => e.message)));
  check('pulling refuses to merge when both sides moved', /both moved on/.test(await gitx.pull(top).then(() => '', (e) => e.message)));
  fs.rmSync(other, { recursive: true, force: true });
  fs.rmSync(bare, { recursive: true, force: true });
  fs.rmSync(top, { recursive: true, force: true });
  fs.rmSync(top + '.worktrees', { recursive: true, force: true });
})().catch((e) => check('git branches and worktrees', false, e.stack)).finally(() => {
  console.log(`${pass} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
});
