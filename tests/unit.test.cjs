const fs = require('fs'), os = require('os'), path = require('path');
const repo = process.cwd();
const inst = require(path.join(repo, 'electron', 'project', 'instant.cjs'));
const comps = require(path.join(repo, 'electron', 'project', 'components.cjs'));
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

const runsLib = require(path.join(repo, 'electron', 'project', 'runs.cjs'));
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

const { translate } = require(path.join(repo, 'electron', 'agents', 'generic.cjs'));
const { harnesses, splitArgs } = require(path.join(repo, 'electron', 'agents', 'harnesses.cjs'));
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
  const gitx = require(path.join(repo, 'electron', 'git', 'index.cjs'));
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

  // Shared rules, handing a chat over, reading a file for the viewer.
  const project = require(path.join(repo, 'electron', 'project', 'store.cjs'));
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
  project.writeMemory(proj, [{ id: 'a', text: 'Mine only', enabled: true, createdAt: 1 }, { id: 'b', text: 'Use pill buttons', enabled: true, createdAt: 2, shared: true }]);
  const rules = fs.readFileSync(path.join(proj, 'PINPOINT.md'), 'utf8');
  check('a shared rule goes to the committed file, a private one does not', rules.includes('- Use pill buttons') && !rules.includes('Mine only'), rules);
  let mem = project.readMemory(proj);
  check('both come back, marked', mem.length === 2 && mem.find((m) => m.text === 'Use pill buttons').shared && !mem.find((m) => m.text === 'Mine only').shared, JSON.stringify(mem));
  fs.appendFileSync(path.join(proj, 'PINPOINT.md'), '- From a teammate\n');
  mem = project.readMemory(proj);
  check("a teammate's rule pulled from git is picked up", mem.some((m) => m.text === 'From a teammate' && m.enabled && m.shared));
  mem = project.writeMemory(proj, mem.map((m) => (m.text === 'From a teammate' ? { ...m, enabled: false } : m)));
  check('switching a shared rule off is personal: the file keeps it', fs.readFileSync(path.join(proj, 'PINPOINT.md'), 'utf8').includes('From a teammate') && mem.find((m) => m.text === 'From a teammate').enabled === false, JSON.stringify(mem));
  fs.writeFileSync(path.join(proj, 'PINPOINT.md'), '# Team notes\n\nKeep this paragraph.\n\n- One rule\n');
  project.writeMemory(proj, project.readMemory(proj).map((m) => (m.shared ? { ...m, text: 'Changed rule' } : m)));
  const edited = fs.readFileSync(path.join(proj, 'PINPOINT.md'), 'utf8');
  check('editing rules keeps what else the file says', edited.includes('Keep this paragraph.') && edited.includes('- Changed rule') && !edited.includes('- One rule'), edited);
  project.writeMemory(proj, project.readMemory(proj).filter((m) => !m.shared));
  check('removing the last rule keeps other writing', fs.readFileSync(path.join(proj, 'PINPOINT.md'), 'utf8').includes('Keep this paragraph.'));

  const packed = project.packThread({ title: 'T', renamed: 'Named', createdAt: 5, agent: 'claude', branch: 'feat', session: { id: 'secret', agent: 'claude' }, items: [
    { kind: 'user', id: 'u', text: 'hi', annotations: [] },
    { kind: 'approval', id: 'p', status: 'pending' },
    { kind: 'done', id: 'd', runId: 'r', ok: true, shots: true, changes: [{ path: 'a.css' }, { path: 'b.css', reverted: true }] },
  ] });
  check('a packed chat carries no session', !JSON.stringify(packed).includes('secret'));
  const got = project.unpackThread(JSON.parse(JSON.stringify(packed)), 'new');
  check('runs become notes, approvals are dropped', got.id === 'new' && got.title === 'Named' && !got.session && !got.items.some((i) => i.kind === 'done' || i.kind === 'approval') && got.items.some((i) => i.text === 'Run finished: changed a.css'), JSON.stringify(got.items));
  check('it says which branch it came from', /from branch feat/.test(got.items[got.items.length - 1].text));
  check('other files are refused', /isn't a Pinpoint chat/.test((() => { try { project.unpackThread({ pinpointHandoff: 1 }, 'x'); return ''; } catch (e) { return e.message; } })()));

  fs.writeFileSync(path.join(proj, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(proj, 'b.bin'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(proj, 'big.txt'), 'x'.repeat(1024 * 1024 + 5));
  check('a file is read', project.readProjectFile(proj, 'a.txt').text === 'hello');
  check('a binary file is flagged', project.readProjectFile(proj, 'b.bin').binary === true);
  check('a huge file is cut', project.readProjectFile(proj, 'big.txt').truncated === true && project.readProjectFile(proj, 'big.txt').text.length === 1024 * 1024);
  const outside = path.join(path.dirname(proj), `${path.basename(proj)}-out.txt`);
  fs.writeFileSync(outside, 'secret');
  check('a path outside the project is refused', /outside/.test((() => { try { project.readProjectFile(proj, `../${path.basename(outside)}`); return ''; } catch (e) { return e.message; } })()));
  fs.rmSync(outside, { force: true });
  fs.rmSync(proj, { recursive: true, force: true });

  // The chat store: screenshots live apart, the list comes from an index.
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'store-'));
  const shot = 'data:image/png;base64,' + 'Q'.repeat(5000);
  const chat = (id, extra = {}) => ({ id, title: `T${id}`, createdAt: 1, updatedAt: 2, agent: 'claude', session: null, items: [{ kind: 'user', id: 'u', text: 'needle here', annotations: [{ id: 'a', image: shot }] }], ...extra });
  await project.saveChat(store, chat('one'));
  await project.saveChat(store, chat('two'));
  const rawOne = () => fs.readFileSync(path.join(store, '.pinpoint', 'chats', 'one.json'), 'utf8');
  check('a saved chat keeps its screenshots outside its file', !rawOne().includes('data:image') && rawOne().includes('pp-blob:'));
  check('and gets them back when loaded', (await project.loadChat(store, 'one')).items[0].annotations[0].image === shot);
  check('the list has both chats', (await project.listChats(store)).length === 2);
  await project.patchChat(store, 'one', { renamed: 'Named', pinned: true });
  await project.saveChat(store, chat('one', { updatedAt: 3 }));
  let row = (await project.listChats(store)).find((c) => c.id === 'one');
  check('a save keeps the name and pin set from the sidebar', row.title === 'Named' && row.pinned === true, JSON.stringify(row));
  const outside1 = JSON.parse(rawOne());
  outside1.title = 'Changed elsewhere'; outside1.renamed = undefined;
  fs.writeFileSync(path.join(store, '.pinpoint', 'chats', 'one.json'), JSON.stringify(outside1));
  row = (await project.listChats(store)).find((c) => c.id === 'one');
  check('a file changed outside the app is noticed', row.title === 'Changed elsewhere', JSON.stringify(row));
  const old = chat('old');
  fs.writeFileSync(path.join(store, '.pinpoint', 'chats', 'old.json'), JSON.stringify({ ...old, items: Array.from({ length: 30 }, () => old.items[0]) }));
  check('a chat from an older version is listed', (await project.listChats(store)).some((c) => c.id === 'old'));
  check('and shrunk', !fs.readFileSync(path.join(store, '.pinpoint', 'chats', 'old.json'), 'utf8').includes('data:image'));
  check('its screenshots survive', (await project.loadChat(store, 'old')).items[29].annotations[0].image === shot);
  check('search finds the words', (await project.searchChats(store, 'needle')).length === 3);
  const blobs = () => fs.readdirSync(path.join(store, '.pinpoint', 'chats', 'blobs')).length;
  await project.deleteChat(store, 'one');
  check('a screenshot other chats use stays when one is deleted', blobs() === 1 && (await project.loadChat(store, 'two')).items[0].annotations[0].image === shot);
  await project.deleteChat(store, 'two');
  await project.deleteChat(store, 'old');
  check('and goes with the last one', blobs() === 0);
  await Promise.all(Array.from({ length: 5 }, (_, i) => project.saveChat(store, chat('race', { updatedAt: i }))));
  check('quick saves land in order', (await project.loadChat(store, 'race')).updatedAt === 4);
  await project.saveChat(store, { id: 'c', title: 't', updatedAt: 1, items: [], branch: 'feature' });
  await project.saveChat(store, { id: 'c', title: 't', updatedAt: 2, items: [], branch: 'main' });
  check('a chat keeps the branch it started on', (await project.loadChat(store, 'c')).branch === 'feature');
  fs.rmSync(store, { recursive: true, force: true });

  // What a run leaves out.
  const ext = require(path.join(repo, 'electron', 'agents', 'extensions.cjs'));
  const claudeFlags = ext.claudeArgs({ extensions: { claude: { mcp: { 'claude.ai Claude Docs': false, keep: true }, skills: { dataviz: false, keep: true } } } });
  check('Claude: switched-off servers and skills are denied, by the names it uses', claudeFlags.join(' ') === '--disallowedTools mcp__claude_ai_Claude_Docs Skill(dataviz)', claudeFlags.join(' '));
  check('Claude: nothing switched off adds nothing', ext.claudeArgs({}).length === 0);
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: long-one\ndescription: >\n  First line\n  second line\nother: x\n---\nBody');
  const longSkill = ext.skillInfo(path.join(skillDir, 'SKILL.md'));
  check('a skill description written as a YAML block is read whole', longSkill.name === 'long-one' && longSkill.description === 'First line second line', JSON.stringify(longSkill));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: short\ndescription: "One line"\n---\n');
  check('and a one-line description too', ext.skillInfo(path.join(skillDir, 'SKILL.md')).description === 'One line');
  fs.rmSync(skillDir, { recursive: true, force: true });
  const codexFlags = ext.codexArgs({ extensions: { codex: { mcp: { on: true, off: false, 'odd name': false }, skills: { 'C:\\s\\SKILL.md': false } } } }).join(' ');
  check('Codex: each server is overridden, on or off', codexFlags.includes('mcp_servers.on.enabled=true') && codexFlags.includes('mcp_servers.off.enabled=false') && codexFlags.includes('mcp_servers."odd name".enabled=false'), codexFlags);
  check('Codex: a skill is switched off by its path', codexFlags.includes('skills.config=[{path="C:/s/SKILL.md",enabled=false}]'), codexFlags);

  // Working out how to run a project.
  const devserver = require(path.join(repo, 'electron', 'project', 'devserver.cjs'));
  const proj2 = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stack-'));
  const put = (root, files) => { for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), typeof body === 'string' ? body : JSON.stringify(body)); } return root; };
  const cands = (files) => { const r = put(proj2(), files); const d = devserver.detect(r); fs.rmSync(r, { recursive: true, force: true }); return d; };
  let d2 = cands({ 'nx.json': {}, 'package-lock.json': '{}', 'apps/web/project.json': { name: 'web', projectType: 'application', targets: { serve: { executor: '@nx/vite:dev-server', options: { port: 4300 } } } }, 'apps/api/project.json': { name: 'api', targets: { serve: { executor: '@nx/js:node' } } }, 'libs/ui/project.json': { name: 'ui', targets: { build: {} } } });
  check('Nx: the web app comes first, run through nx, with its port', d2.command === 'npx nx serve web' && d2.candidates[0].port === 4300, JSON.stringify(d2));
  check('Nx: the API is offered as a service, libraries are not', d2.candidates.some((c) => c.command === 'npx nx serve api' && c.kind === 'api') && !d2.candidates.some((c) => /\bui\b/.test(c.command)), JSON.stringify(d2.candidates));
  d2 = cands({ 'turbo.json': {}, 'pnpm-lock.yaml': '', 'node_modules/.x': '', 'pnpm-workspace.yaml': 'packages:\n  - "apps/*"\n  - tools/cli\n', 'package.json': { scripts: { dev: 'turbo run dev' } }, 'apps/site/package.json': { name: '@me/site', scripts: { dev: 'next dev -p 3100' } } });
  check('Turborepo: a package runs through turbo with a filter', d2.command === 'pnpm exec turbo run dev --filter=@me/site' && d2.candidates[0].port === 3100, JSON.stringify(d2));
  d2 = cands({ 'package.json': { workspaces: ['clients/**'] }, 'clients/admin/panel/package.json': { scripts: { dev: 'vite' } } });
  check('workspace globs reach any folder', /cd clients.admin.panel && npm run dev/.test(d2.command), JSON.stringify(d2));
  d2 = cands({ 'frontend/package.json': { scripts: { dev: 'vite' } }, 'frontend/node_modules/.x': '', 'backend/app/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n', 'backend/uv.lock': '' });
  check('a frontend with a Python API: the page is primary', /frontend && npm run dev/.test(d2.command), JSON.stringify(d2));
  d2 = cands({ 'backend/main.py': 'from fastapi import FastAPI\napi = FastAPI()\n', 'backend/uv.lock': '' });
  check('FastAPI: found with its runner, module and app name', /cd backend && uv run uvicorn main:api --reload/.test(d2.command) && d2.candidates[0].kind === 'api' && d2.candidates[0].port === 8000, JSON.stringify(d2));
  check('Flask', cands({ 'app.py': 'from flask import Flask\napp = Flask(__name__)\n' }).command === 'flask --app app run --debug');
  check('Django', cands({ 'manage.py': '' }).command === 'python manage.py runserver');
  check('Go with cmd folders', cands({ 'go.mod': 'module x', 'cmd/api/main.go': '' }).command === 'go run ./cmd/api');
  check('Rust web service', cands({ 'Cargo.toml': '[dependencies]\naxum = "1"', 'src/main.rs': '' }).command === 'cargo run');
  check('Spring Boot with the wrapper', cands({ 'pom.xml': '<artifactId>spring-boot</artifactId>', mvnw: '' }).command === './mvnw spring-boot:run');
  check('.NET', cands({ 'App.csproj': '<Project/>' }).command === 'dotnet watch run');
  check('Phoenix', cands({ 'mix.exs': '{:phoenix, "~> 1.7"}' }).command === 'mix phx.server');
  check('Deno tasks', cands({ 'deno.json': { tasks: { dev: 'deno run main.ts' } } }).command === 'deno task dev');
  d2 = cands({ 'Procfile.dev': 'web: bin/rails s -p $PORT\nworker: bundle exec sidekiq\n' });
  check('a Procfile lists each service', d2.candidates.some((c) => c.kind === 'web' && /-p 3000/.test(c.command)) && d2.candidates.some((c) => c.kind === 'worker'), JSON.stringify(d2.candidates));
  check('make and just targets', cands({ Makefile: 'build:\n\tgo build\ndev:\n\tair\n' }).command === 'make dev' && cands({ justfile: 'serve port="1":\n  x\n' }).command === 'just serve');
  d2 = cands({ 'docker-compose.yml': 'services:\n  web:\n    ports:\n      - "8088:80"\n' });
  check('Docker Compose with its published port', d2.command === 'docker compose up' && d2.candidates[0].port === 8088, JSON.stringify(d2));
  check('a plain Vite project is unchanged', cands({ 'package.json': { scripts: { dev: 'vite', build: 'vite build' } }, 'node_modules/.x': '', 'package-lock.json': '{}' }).command === 'npm run dev');
  check('an empty folder finds nothing', cands({ 'notes.txt': '' }).command === '');

  const { buildPrompt } = require(path.join(repo, 'electron', 'prompt', 'index.cjs'));
  const reqBase = { url: 'http://x/', title: '', viewport: { width: 1000, height: 800 }, instruction: 'Do it', annotations: [], carried: 'User: earlier words' };
  check('a new session is told the earlier conversation', buildPrompt({ request: reqBase, files: {}, projectDir: repo, followUp: false }).includes('earlier words'));
  check('a resumed session is not', !buildPrompt({ request: reqBase, files: {}, projectDir: repo, followUp: true }).includes('earlier words'));
})().catch((e) => check('git branches and worktrees', false, e.stack)).finally(() => {
  console.log(`${pass} pass, ${failed} fail`);
  process.exit(failed ? 1 : 0);
});
