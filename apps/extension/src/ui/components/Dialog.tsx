import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Dialog({ open, title, onClose, returnFocusTo, children }: { open: boolean; title: string; onClose(): void; /** Used when the opener is gone by the time the dialog closes. */ returnFocusTo?: () => HTMLElement | null; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.open) el.showModal();
    // The dialog unmounts when closed, so restore focus to whatever opened it.
    return () => {
      if (el.open) el.close();
      if (opener?.isConnected) opener.focus();
      else returnFocusTo?.()?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <dialog ref={ref} className="im-dialog" aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <h2 id={titleId} className="im-dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
