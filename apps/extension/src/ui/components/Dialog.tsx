import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={ref} className="im-dialog" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id={titleId} className="im-dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
