import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const ICON_WEIGHTS = ['regular', 'fill'];

function slimIcons(): Plugin {
  const unused = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin'].filter((w) => !ICON_WEIGHTS.includes(w)).join('|');
  const entry = new RegExp(`\\n  \\[\\n    "(?:${unused})",[\\s\\S]*?\\n  \\],?`, 'g');
  return {
    name: 'pinpoint-slim-icons',
    apply: 'build',
    transform(code, id) {
      if (!/@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/]/.test(id)) return null;
      const slim = code.replace(entry, '');
      if (!ICON_WEIGHTS.every((w) => slim.includes(`"${w}"`))) return null;
      return { code: slim, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), slimIcons()],
  base: './',
  server: { port: 5177, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true },
});
