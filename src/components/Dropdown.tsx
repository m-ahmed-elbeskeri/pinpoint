import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownItem {
  value: string;
  label: string;
  desc?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface Props {
  value: string;
  items: DropdownItem[];
  onChange(value: string): void;
  icon?: ReactNode;
  title?: string;         // tooltip + menu header
  display?: string;       // override the button label
  disabled?: boolean;
  align?: 'left' | 'right';
  className?: string;
}

// Compact pill button that opens an upward menu (it lives in the composer footer).
export function Dropdown({ value, items, onChange, icon, title, display, disabled, align = 'left', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.value === value);

  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, items.findIndex((i) => i.value === value)));
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: DropdownItem) => { if (!i.disabled) { onChange(i.value); setOpen(false); } };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { setOpen(true); e.preventDefault(); } return; }
    e.stopPropagation();
    if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'ArrowDown') { setHi((h) => Math.min(items.length - 1, h + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHi((h) => Math.max(0, h - 1)); e.preventDefault(); }
    else if (e.key === 'Enter' && items[hi]) { pick(items[hi]); e.preventDefault(); }
  };

  return (
    <div className={`dd ${className}`} ref={ref} onKeyDown={onKey}>
      <button type="button" className={`dd-btn ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} disabled={disabled} title={title}>
        {icon}
        <span className="dd-label">{display ?? current?.label ?? 'Select'}</span>
        <ChevronDown size={12} className="dd-chev" />
      </button>
      {open && (
        <div className={`dd-menu ${align}`} role="listbox">
          {title && <div className="dd-title">{title}</div>}
          {items.map((i, idx) => (
            <button
              type="button"
              key={i.value}
              role="option"
              aria-selected={i.value === value}
              className={`dd-item ${idx === hi ? 'hi' : ''} ${i.value === value ? 'sel' : ''}`}
              disabled={i.disabled}
              onMouseEnter={() => setHi(idx)}
              onClick={() => pick(i)}
            >
              {i.icon && <span className="dd-item-icon">{i.icon}</span>}
              <span className="dd-item-text">
                <span>{i.label}</span>
                {i.desc && <small>{i.desc}</small>}
              </span>
              {i.value === value && <Check size={14} className="dd-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
