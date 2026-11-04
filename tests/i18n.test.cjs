const fs = require('fs'), os = require('os'), path = require('path');
const repo = process.cwd();
const i18n = require(path.join(repo, 'electron', 'project', 'i18n.cjs'));
const describe = require(path.join(repo, 'electron', 'prompt', 'describe.cjs'));
let pass = 0, failed = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), text); };
write('src/locales/en/common.json', '{\n    "nav": {\n        "home": "Home",\n        "greet": "Hello, {{name}}!"\n    },\n    "buy": "Buy <b>now</b>"\n}\n');
write('src/locales/fr/common.json', '{\n    "nav": {\n        "home": "Accueil"\n    }\n}\n');
write('messages/en.json', '{"title":"Pricing"}');
write('messages/de-DE.json', '{"title":"Preise"}');
write('src/data/en.json', '{"title":"Not a translation folder"}');
write('node_modules/x/locales/en.json', '{"title":"Pricing"}');

const files = i18n.scan(d);
check('finds translation files by folder, with locale and namespace', files.length === 4 && files.some((f) => f.locale === 'fr' && f.ns === 'common') && files.some((f) => f.locale === 'de-DE' && f.ns === ''), JSON.stringify(files));
check('skips JSON outside translation folders and in node_modules', !files.some((f) => /data|node_modules/.test(f.file)));

const greet = i18n.find(d, 'Hello, Sam!');
check('placeholders match any text', greet.matches.length === 1 && greet.matches[0].key === 'nav.greet', JSON.stringify(greet));
check('a language without the key shows it as missing', greet.matches[0]?.values.find((v) => v.locale === 'fr')?.value === null);
check('markup in a value is ignored when matching', i18n.find(d, 'Buy now').matches[0]?.key === 'buy');
check('copy that is not in any file finds nothing', i18n.find(d, 'Checkout').matches.length === 0);

const gaps = i18n.missing(d);
check('missing keys are counted against English', gaps.length === 1 && gaps[0].locale === 'fr' && gaps[0].keys.join() === 'nav.greet,buy', JSON.stringify(gaps));

const p = i18n.prepare(d, [{ file: 'src/locales/fr/common.json', key: 'nav.greet', value: 'Bonjour, {{name}} !' }, { file: 'src/locales/fr/common.json', key: 'nav.home', value: 'Maison' }]);
const out = p.writes[0][1];
check('writes nested keys, keeping indentation, order and the final newline', out === '{\n    "nav": {\n        "home": "Maison",\n        "greet": "Bonjour, {{name}} !"\n    }\n}\n', JSON.stringify(out));
let refused = '';
try { i18n.prepare(d, [{ file: 'package.json', key: 'name', value: 'x' }]); } catch (e) { refused = e.message; }
check('refuses to write a file that is not a translation file', /isn't a translation file/.test(refused));

const flow = describe.describeAnnotation
  ? describe.describeAnnotation({ n: 1, kind: 'flow', note: 'cart is wrong', steps: [{ type: 'click', selector: 'button.remove', text: 'Remove', after: { state: ['Cart state #1: 3 → 2'], requests: ['DELETE /api/cart/4 → 200 (40 ms)'] } }] }, {})
  : null;
if (flow) {
  const text = Array.isArray(flow) ? flow.join('\n') : String(flow);
  check('a recorded step carries the state and requests that followed it', text.includes('state changed: Cart state #1: 3 → 2') && text.includes('request: DELETE /api/cart/4'), text);
}

fs.rmSync(d, { recursive: true, force: true });
console.log(`${pass} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);
