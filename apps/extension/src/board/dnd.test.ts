import { describe, expect, test } from 'vitest';
import type { Category, Item } from '@atelier/core';
import { computeCategoryDrop, computeItemDrop } from './dnd';

const items = (...ids: string[]) => ids.map((id) => ({ id }) as Item);
const cats = (...ids: string[]) => ids.map((id) => ({ id }) as Category);

describe('computeItemDrop', () => {
  test('empty column', () => {
    expect(computeItemDrop({ categoryId: 'c', overItemId: null, placement: 'after' }, [])).toEqual({ categoryId: 'c', beforeId: null, afterId: null });
  });
  test('before first', () => {
    expect(computeItemDrop({ categoryId: 'c', overItemId: 'a', placement: 'before' }, items('a', 'b'))).toEqual({ categoryId: 'c', beforeId: null, afterId: 'a' });
  });
  test('after last', () => {
    expect(computeItemDrop({ categoryId: 'c', overItemId: 'b', placement: 'after' }, items('a', 'b'))).toEqual({ categoryId: 'c', beforeId: 'b', afterId: null });
  });
  test('between two', () => {
    expect(computeItemDrop({ categoryId: 'c', overItemId: 'b', placement: 'before' }, items('a', 'b', 'c'))).toEqual({ categoryId: 'c', beforeId: 'a', afterId: 'b' });
    expect(computeItemDrop({ categoryId: 'c', overItemId: 'a', placement: 'after' }, items('a', 'b', 'c'))).toEqual({ categoryId: 'c', beforeId: 'a', afterId: 'b' });
  });
  test('append to another category when no over item', () => {
    expect(computeItemDrop({ categoryId: 'd', overItemId: null, placement: 'before' }, items('x', 'y'))).toEqual({ categoryId: 'd', beforeId: 'y', afterId: null });
  });
  test('unknown over item appends', () => {
    expect(computeItemDrop({ categoryId: 'd', overItemId: 'gone', placement: 'before' }, items('x'))).toEqual({ categoryId: 'd', beforeId: 'x', afterId: null });
  });
});

describe('computeCategoryDrop', () => {
  test('before and after', () => {
    expect(computeCategoryDrop('a', 'before', cats('a', 'b'))).toEqual({ beforeId: null, afterId: 'a' });
    expect(computeCategoryDrop('b', 'after', cats('a', 'b'))).toEqual({ beforeId: 'b', afterId: null });
    expect(computeCategoryDrop('b', 'before', cats('a', 'b', 'c'))).toEqual({ beforeId: 'a', afterId: 'b' });
  });
});
