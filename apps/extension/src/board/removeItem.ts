/**
 * Rows unmount on delete, so hand focus to the next row's primary control, or else the column heading.
 * `del` resolves to whether the delete succeeded.
 */
export async function removeAndRefocus(el: HTMLElement | null, del: () => Promise<boolean>) {
  const next = el?.nextElementSibling;
  const target = (next?.classList.contains('atl-item') ? next.querySelector<HTMLElement>('a, input, [contenteditable]') : null)
    ?? el?.closest('section')?.querySelector<HTMLElement>('.atl-title-btn');
  if (await del()) target?.focus();
}
