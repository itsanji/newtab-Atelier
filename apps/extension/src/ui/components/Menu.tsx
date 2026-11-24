import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; hint?: string };

export function Menu({ trigger, items }: { trigger: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <div className="im-menu" ref={root}>
      <button type="button" className="im-btn" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div id={listId} role="menu" className="im-menu-list">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={['im-menu-item', item.danger && 'im-menu-item-danger'].filter(Boolean).join(' ')}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <span className="im-menu-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
