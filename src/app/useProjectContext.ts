import { api } from './shared';
import { uid } from '../lib/draw';
import type { ChatItem, DesignDoc, DesignSystem, MemoryItem, RouteInfo } from '../types';
import { matchRoute } from '../lib/urls';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppContext } from './context';

export function useProjectContext(app: AppContext) {
  const settings = app.settings;
  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [memory, setMemory] = useState<MemoryItem[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [designSystem, setDesignSystem] = useState<DesignSystem | null>(null);
  const refreshRoutes = useCallback(() => { api.listRoutes().then(setRoutes).catch(() => setRoutes([])); }, []);
  useEffect(() => {
    if (!app.projectDir) return;
    api.siteHints().then((h) => app.setTwins((t) => ({ ...t, homepage: h.homepage || '' }))).catch(() => {});
  }, [app.projectDir]);
  const designChanged = !!app.session && app.designAtStart !== null && (settings?.useDesign && design?.exists ? design.content : '') !== app.designAtStart;
  const currentRoute = useMemo(() => matchRoute(routes, app.nav.url, app.projectDir), [routes, app.nav.url, app.projectDir]);
  const onMemoryAction = (id: string, action: 'save' | 'dismiss') => {
    const item = app.chat.find((c) => c.id === id && c.kind === 'memory') as Extract<ChatItem, { kind: 'memory' }> | undefined;
    if (!item) return;
    if (action === 'save' && !memory.some((m) => m.text.toLowerCase() === item.text.toLowerCase())) {
      const next = [{ id: uid(), text: item.text, enabled: true, createdAt: Date.now() }, ...memory];
      setMemory(next);
      api.writeMemory(next);
    }
    app.setChat((c) => c.map((it) => (it.id === id && it.kind === 'memory' ? { ...it, status: action === 'save' ? 'saved' : 'dismissed' } : it)));
  };
  const askAgentForDesign = (draft: string | null) => {
    app.setSheet(null);
    app.setInstruction(
      `${design?.exists ? 'Improve' : 'Create'} DESIGN.md at the project root: a concise design system for this project (colors, typography, spacing, radii, shadows, key components and usage rules). ` +
      'Base it on the code (theme / Tailwind config, CSS variables, shared components)' + (draft ? ' and this draft extracted from the rendered page:\n\n' + draft : '.'),
    );
    app.focusComposer(50);
  };
  const memoryOn = settings?.useMemory ? memory.filter((m) => m.enabled).length : 0;
  useEffect(() => { if (app.sheet === 'memory' && app.projectDir) api.readMemory().then(setMemory).catch(() => {}); }, [app.sheet, app.projectDir]);

  Object.assign(app, { askAgentForDesign, currentRoute, design, designChanged, designSystem, memory, memoryOn, onMemoryAction, refreshRoutes, routes, setDesign, setDesignSystem, setMemory });
}
