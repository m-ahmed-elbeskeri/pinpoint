import type { ReactNode } from 'react';

// A popup menu for keyboard and screen-reader users: focus moves to the first item on open (or the menu itself while
// its items load), arrows and Home/End move between items, Enter or Space picks a non-button item, and after a
// keyboard close focus goes back to the opener. Opening and closing stay with the caller (useDismiss: Esc, clicks outside).
// Mouse use is unchanged: focus moved by script after a click shows no ring, and isn't handed back.
// What callers mark up: items carry role="menuitem" (disabled ones are skipped); an item marked data-keeps-focus moves
// focus on its own (Rename's input), so closing through it hands nothing back.
export function Menu({ className, label, children }: { className: string; label?: string; children: ReactNode }) {
  return (
    <div role="menu" aria-label={label} className={className} tabIndex={-1} ref={takeFocus} onKeyDown={moveFocus} onClick={stop}>
      {children}
    </div>
  );
}

const stop = (e: React.MouseEvent) => e.stopPropagation();
const itemsOf = (menu: Element) => [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];

function takeFocus(menu: HTMLDivElement) {
  const opener = document.activeElement as HTMLElement | null;
  (itemsOf(menu)[0] ?? menu).focus({ preventScroll: true });
  // Hand focus back only to a keyboard user whose focus is still in the menu; a mouse user's stays where the click left it.
  return () => {
    const at = document.activeElement;
    if (at && menu.contains(at) && at.matches(':focus-visible') && !at.closest('[data-keeps-focus]')) opener?.focus({ preventScroll: true });
  };
}

function moveFocus(e: React.KeyboardEvent<HTMLDivElement>) {
  const items = itemsOf(e.currentTarget);
  const at = items.indexOf(document.activeElement as HTMLElement);
  const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
  if (e.key === 'ArrowDown') go(at + 1);
  else if (e.key === 'ArrowUp') go(at < 0 ? -1 : at - 1);
  else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(-1);
  else if ((e.key === 'Enter' || e.key === ' ') && at >= 0 && items[at].tagName !== 'BUTTON') { e.preventDefault(); items[at].click(); }
}
