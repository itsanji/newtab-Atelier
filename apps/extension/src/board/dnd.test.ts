import { describe, expect, test } from 'vitest';
import type { Active, ClientRect, DroppableContainer } from '@dnd-kit/core';
import type { Category, Item } from '@atelier/core';
import { collisions, computeCategoryDrop, computeItemDrop } from './dnd';

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

describe('collisions', () => {
  type Kind = 'item' | 'category' | 'workspace' | 'newcat';
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as ClientRect;
  const run = (activeType: string, pointer: { x: number; y: number } | null, targets: [string, Kind, ClientRect][]) => {
    const droppableContainers = targets.map(([id, type]) => ({ id, data: { current: { type } } })) as unknown as DroppableContainer[];
    const droppableRects = new Map(targets.map(([id, , r]) => [id, r]));
    return collisions({
      active: { id: 'a', data: { current: { type: activeType } } } as unknown as Active,
      collisionRect: rect(500, 500, 10, 10),
      droppableRects: droppableRects as Parameters<typeof collisions>[0]['droppableRects'],
      droppableContainers,
      pointerCoordinates: pointer,
    }).map((c) => c.id);
  };
  const board: [string, Kind, ClientRect][] = [
    ['ws1', 'workspace', rect(0, 0, 100, 40)],
    ['col1', 'category', rect(200, 0, 200, 400)],
    ['it1', 'item', rect(200, 50, 200, 40)],
    ['new', 'newcat', rect(420, 0, 200, 400)],
  ];

  test('pointer over nothing gives no target', () => {
    expect(run('item', { x: 150, y: 600 }, board)).toEqual([]);
    expect(run('tab', { x: 150, y: 600 }, board)).toEqual([]);
  });
  test('a keyboard drag (no pointer) takes the closest target, not a far workspace', () => {
    const near: [string, Kind, ClientRect][] = [
      ['ws1', 'workspace', rect(0, 0, 100, 40)],
      ['it1', 'item', rect(495, 495, 20, 20)],
    ];
    expect(run('item', null, near)[0]).toBe('it1');
  });
  test('an item under the pointer wins over its column', () => {
    expect(run('item', { x: 250, y: 60 }, board)[0]).toBe('it1');
  });
  test('the column when the pointer is in its empty space', () => {
    expect(run('item', { x: 250, y: 300 }, board)).toEqual(['col1']);
  });
  test('the workspace row under the pointer', () => {
    expect(run('tab', { x: 20, y: 20 }, board)[0]).toBe('ws1');
  });
  test('the New category tile under the pointer', () => {
    expect(run('tab', { x: 500, y: 200 }, board)).toEqual(['new']);
  });
  test('categories only collide with categories', () => {
    expect(run('category', { x: 20, y: 20 }, board)).not.toContain('ws1');
    expect(run('category', { x: 20, y: 20 }, board)).not.toContain('new');
  });
});
