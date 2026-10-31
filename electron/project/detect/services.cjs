// Backends and other non-JavaScript stacks, and the task files projects keep their own commands in.
const fs = require('node:fs');
const path = require('node:path');

const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const exists = (...p) => fs.existsSync(path.join(...p));
const anyFile = (dir, re) => { try { return fs.readdirSync(dir).find((f) => re.test(f)) || null; } catch { return null; } };
const DEV_TARGET = /^(dev|develop|start|serve|server|run|up|watch)$/;

function pythonRunner(dir) {
  if (exists(dir, 'uv.lock')) return 'uv run ';
  if (exists(dir, 'poetry.lock')) return 'poetry run ';
  if (exists(dir, 'Pipfile')) return 'pipenv run ';
  return '';
}

function pythonEntry(dir) {
  return ['main.py', 'app.py', 'app/main.py', 'src/main.py', 'server.py', 'api.py'].find((f) => /\b(FastAPI|Flask|Starlette|Litestar)\s*\(/.test(readText(path.join(dir, f))));
}

function python(dir) {
  const run = pythonRunner(dir);
  if (exists(dir, 'manage.py')) return [{ command: `${run}python manage.py runserver`, label: 'Django', kind: 'web', port: 8000, score: 45 }];
  const entry = pythonEntry(dir);
  if (!entry) return [];
  const body = readText(path.join(dir, entry));
  const module = entry.replace(/\.py$/, '').split('/').join('.');
  const app = (/^(\w+)\s*=\s*(?:FastAPI|Flask|Starlette|Litestar)\s*\(/m.exec(body) || [])[1] || 'app';
  if (/\bFlask\s*\(/.test(body)) return [{ command: `${run}flask --app ${module} run --debug`, label: 'Flask', kind: 'api', port: 5000, score: 42 }];
  const label = /\bFastAPI\s*\(/.test(body) ? 'FastAPI' : /\bLitestar\s*\(/.test(body) ? 'Litestar' : 'Starlette';
  return [{ command: `${run}uvicorn ${module}:${app} --reload`, label, kind: 'api', port: 8000, score: 42 }];
}

function go(dir) {
  if (!exists(dir, 'go.mod')) return [];
  if (exists(dir, '.air.toml')) return [{ command: 'air', label: 'Go (air)', kind: 'api', port: 8080, score: 40 }];
  const cmds = (() => { try { return fs.readdirSync(path.join(dir, 'cmd'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } })();
  if (cmds.length) return cmds.slice(0, 4).map((c) => ({ command: `go run ./cmd/${c}`, label: `Go: ${c}`, kind: 'api', port: 8080, score: 38 }));
  return exists(dir, 'main.go') ? [{ command: 'go run .', label: 'Go', kind: 'api', port: 8080, score: 38 }] : [];
}

function rust(dir) {
  const toml = readText(path.join(dir, 'Cargo.toml'));
  if (!toml || !exists(dir, 'src', 'main.rs')) return [];
  const web = /\b(axum|actix-web|rocket|warp|poem)\b/.test(toml);
  return [{ command: 'cargo run', label: 'Rust', kind: web ? 'api' : 'other', port: web ? 3000 : null, score: web ? 38 : 15 }];
}

function jvm(dir) {
  const gradle = exists(dir, 'build.gradle') ? readText(path.join(dir, 'build.gradle')) : readText(path.join(dir, 'build.gradle.kts'));
  const wrapper = exists(dir, 'gradlew') ? './gradlew' : 'gradle';
  if (/org\.springframework\.boot/.test(gradle)) return [{ command: `${wrapper} bootRun`, label: 'Spring Boot', kind: 'api', port: 8080, score: 40 }];
  if (/io\.ktor/.test(gradle)) return [{ command: `${wrapper} run`, label: 'Ktor', kind: 'api', port: 8080, score: 40 }];
  const pom = readText(path.join(dir, 'pom.xml'));
  const mvn = exists(dir, 'mvnw') ? './mvnw' : 'mvn';
  if (/spring-boot/.test(pom)) return [{ command: `${mvn} spring-boot:run`, label: 'Spring Boot', kind: 'api', port: 8080, score: 40 }];
  if (/quarkus/.test(pom)) return [{ command: `${mvn} quarkus:dev`, label: 'Quarkus', kind: 'api', port: 8080, score: 40 }];
  return [];
}

function others(dir) {
  const out = [];
  if (anyFile(dir, /\.csproj$/)) out.push({ command: 'dotnet watch run', label: '.NET', kind: 'api', port: 5000, score: 40 });
  if (exists(dir, 'artisan')) out.push({ command: 'php artisan serve', label: 'Laravel', kind: 'web', port: 8000, score: 45 });
  if (exists(dir, 'bin', 'rails')) out.push({ command: 'bin/rails server', label: 'Rails', kind: 'web', port: 3000, score: 45 });
  if (exists(dir, 'mix.exs') && /:phoenix\b/.test(readText(path.join(dir, 'mix.exs')))) out.push({ command: 'mix phx.server', label: 'Phoenix', kind: 'web', port: 4000, score: 45 });
  const deno = readText(path.join(dir, 'deno.json')) || readText(path.join(dir, 'deno.jsonc'));
  const task = (/"(dev|start|serve)"\s*:/.exec((/"tasks"\s*:\s*\{[^}]*\}/.exec(deno) || [''])[0]) || [])[1];
  if (task) out.push({ command: `deno task ${task}`, label: 'Deno', kind: 'web', port: 8000, score: 42 });
  return out;
}

function backends(dir) {
  return [...python(dir), ...go(dir), ...rust(dir), ...jvm(dir), ...others(dir)];
}

// Procfile.dev / Procfile entries: each line is a service of its own.
function procfile(dir) {
  const file = ['Procfile.dev', 'Procfile'].find((f) => exists(dir, f));
  if (!file) return [];
  const out = [];
  for (const line of readText(path.join(dir, file)).split(/\r?\n/)) {
    const m = /^([\w-]+):\s*(.+)$/.exec(line.trim());
    if (m && m[1] !== 'release') out.push({ command: m[2].replace(/\$PORT|\$\{PORT\}/g, '3000'), label: `${file}: ${m[1]}`, kind: /^web$/.test(m[1]) ? 'web' : /worker|queue|job/.test(m[1]) ? 'worker' : 'api', port: m[1] === 'web' ? 3000 : null, score: file === 'Procfile.dev' ? 44 : 30 });
  }
  return out;
}

function taskTargets(dir) {
  const out = [];
  const make = readText(path.join(dir, 'Makefile')) || readText(path.join(dir, 'makefile'));
  for (const m of make.matchAll(/^([a-zA-Z][\w-]*):/gm)) if (DEV_TARGET.test(m[1])) out.push({ command: `make ${m[1]}`, label: 'Makefile', kind: 'other', port: null, score: 28 });
  const just = readText(path.join(dir, 'justfile')) || readText(path.join(dir, 'Justfile'));
  for (const m of just.matchAll(/^([a-zA-Z][\w-]*)[^\n:]*:(?!=)/gm)) if (DEV_TARGET.test(m[1])) out.push({ command: `just ${m[1]}`, label: 'justfile', kind: 'other', port: null, score: 28 });
  const task = readText(path.join(dir, 'Taskfile.yml')) || readText(path.join(dir, 'Taskfile.yaml'));
  const tasks = (/^tasks:\s*\n([\s\S]*)/m.exec(task) || [])[1] || '';
  for (const m of tasks.matchAll(/^ {2}([a-zA-Z][\w:-]*):/gm)) if (DEV_TARGET.test(m[1])) out.push({ command: `task ${m[1]}`, label: 'Taskfile', kind: 'other', port: null, score: 28 });
  return out;
}

// Docker Compose: the stack as one command, with the first published port as its address.
function compose(dir) {
  const file = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml', 'compose.dev.yaml', 'docker-compose.dev.yml'].find((f) => exists(dir, f));
  if (!file) return [];
  const body = readText(path.join(dir, file));
  const port = (/^\s*-\s*["']?(?:[\d.]+:)?(\d{2,5}):\d{2,5}/m.exec(body) || [])[1];
  const flag = /^(compose|docker-compose)\.ya?ml$/.test(file) ? '' : `-f ${file} `;
  return [{ command: `docker compose ${flag}up`, label: 'Docker Compose', kind: 'stack', port: port ? Number(port) : null, score: 26 }];
}

module.exports = { backends, procfile, taskTargets, compose };
