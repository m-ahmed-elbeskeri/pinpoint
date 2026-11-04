import { defineConfig, type Plugin } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

const ICON_WEIGHTS = ['regular', 'fill'];
// Icons the app also draws in another weight, by their Phosphor name: an icon asked for a weight the build stripped
// renders empty. The top bar's mode buttons are bold when picked; its chat-panel toggle is duotone while the panel shows.
const EXTRA_WEIGHTS: Record<string, string[]> = {
  Cursor: ['bold'], ChatTeardropDots: ['bold'], ScribbleLoop: ['bold'], Shapes: ['bold'],
  SidebarSimple: ['duotone'],
};
const ALL_WEIGHTS = ['bold', 'duotone', 'fill', 'light', 'regular', 'thin'];

function slimIcons(): Plugin {
  const entryFor = (keep: string[]) => new RegExp(`\\n  \\[\\n    "(?:${ALL_WEIGHTS.filter((w) => !keep.includes(w)).join('|')})",[\\s\\S]*?\\n  \\],?`, 'g');
  const entry = entryFor(ICON_WEIGHTS);
  return {
    name: 'pinpoint-slim-icons',
    apply: 'build',
    transform(code, id) {
      const icon = /@phosphor-icons[\\/]react[\\/]dist[\\/]defs[\\/](\w+)\./.exec(id)?.[1];
      if (!icon) return null;
      const keep = [...ICON_WEIGHTS, ...(EXTRA_WEIGHTS[icon] ?? [])];
      const slim = code.replace(EXTRA_WEIGHTS[icon] ? entryFor(keep) : entry, '');
      if (!keep.every((w) => slim.includes(`"${w}"`))) return null;
      return { code: slim, map: null };
    },
  };
}

// React Compiler memoises components for us. The app shell is left out: its hooks share one context object that is
// mutated in place every render, so to the compiler `app` never changes and anything read from it would go stale.
// In compiled code, a value from outside props and state (the clock, the DOM) must come in as an input, or the cached
// result never updates: time labels take `now` from useNow() rather than calling Date.now() inside.
const compiler = reactCompilerPreset();
compiler.rolldown.filter.id = { exclude: /[\/]src[\/](?:App\.tsx$|app[\/])/ };

export default defineConfig({
  plugins: [react(), babel({ presets: [compiler] }), slimIcons()],
  base: './',
  server: { port: 5177, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true },
});
