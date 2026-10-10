const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '.fixtures');
const PROJECTS = {
  viteapp: { pkg: { name: 'viteapp', private: true, type: 'module', scripts: { dev: 'vite' } }, install: 'react@18 react-dom@18 vite @vitejs/plugin-react' },
  tw4: { pkg: { name: 'tw4', private: true }, install: 'tailwindcss@4 @tailwindcss/node@4', files: { 'src/app.css': '@import "tailwindcss";\n@theme { --color-brand: #ff00aa; }\n' } },
  tw3: { pkg: { name: 'tw3', private: true }, install: 'tailwindcss@3 postcss', files: { 'tailwind.config.js': 'module.exports = { content: ["./src/**/*.html"], theme: { extend: { colors: { brand: "#ff00aa" } } } };\n', 'src/app.css': '@tailwind base;\n@tailwind utilities;\n' } },
  vuep: { pkg: { name: 'vuep', private: true }, install: 'vue@3' },
};

for (const [name, p] of Object.entries(PROJECTS)) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(p.pkg, null, 2));
  for (const [rel, text] of Object.entries(p.files || {})) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  console.log(`Installing ${name}…`);
  execSync(`npm install --no-audit --no-fund ${p.install}`, { cwd: dir, stdio: 'inherit' });
}
console.log('Fixtures ready.');
