import { useLayoutEffect, type RefObject } from 'react';

const MARGIN = 8;

/**
 * Nudges an absolutely positioned popover sideways so it stays inside the window, or inside the
 * dialog or `[data-popover-bounds]` element it sits in, instead of spilling past the right edge and
 * making the page scroll sideways.
 */
export function useFitInView(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    el.style.left = '';
    const r = el.getBoundingClientRect();
    if (!r.width) return; // not laid out (tests without layout)
    const bounds = el.closest('dialog, [data-popover-bounds]')?.getBoundingClientRect();
    const left = Math.max(bounds?.left ?? 0, 0) + MARGIN;
    const right = Math.min(bounds?.right ?? Infinity, document.documentElement.clientWidth) - MARGIN;
    let shift = 0;
    if (r.right > right) shift = r.right - right;
    if (r.left - shift < left) shift = r.left - left;
    if (shift) el.style.left = `${el.offsetLeft - shift}px`;
  }, [ref, open]);
}
