import { generateKeyBetween } from 'fractional-indexing';

export function keyBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after);
}

export function sortByKey<T extends { id: string; sortKey: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
