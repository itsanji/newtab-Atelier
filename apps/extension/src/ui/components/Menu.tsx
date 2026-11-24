import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export type MenuItem = { label: string; onSelect(): void; danger?: boolean; disabled?: boolean; hint?: string };

export function Menu({
  trigger, items, triggerLabel, triggerClassName = 'im-btn',
}: { trigger: ReactNode; items: MenuItem[]; triggerLabel?: string; triggerClassName?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();

  const enabled = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);

  useEffect(() => {
    if (!open) return;
    enabled()[0]?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
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

  const onListKey = (e: KeyboardEvent) => {
    const els = enabled();
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (i + 1) % els.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + els.length) % els.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    if (next === null) return;
    e.preventDefault();
    els[next]?.focus();
  };

  return (
    <div className="im-menu" ref={root}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div id={listId} ref={list} role="menu" className="im-menu-list" onKeyDown={onListKey}>
          {items.map((item, index) => (
            <button
              key={index}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={['im-menu-item', item.danger && 'im-menu-item-danger'].filter(Boolean).join(' ')}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                triggerRef.current?.focus();
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
