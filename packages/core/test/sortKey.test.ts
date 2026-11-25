import { expect, test } from 'vitest';
import { keyBetween, sortByKey } from '../src/sortKey';

test('keyBetween(null, null) returns a key', () => expect(typeof keyBetween(null, null)).toBe('string'));

test('keyBetween orders between neighbours', () => {
  const a = keyBetween(null, null);
  const c = keyBetween(a, null);
  const b = keyBetween(a, c);
  expect([c, a, b].sort()).toEqual([a, b, c]);
});

test('sortByKey breaks ties by id', () => {
  expect(
    sortByKey([
      { id: 'b', sortKey: 'a0' },
      { id: 'a', sortKey: 'a0' },
    ]).map((r) => r.id),
  ).toEqual(['a', 'b']);
});
