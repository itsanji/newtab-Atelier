import { describe, expect, test } from 'vitest';
import { arrangeItems } from '../src';

const it = (id: string, kind: 'link' | 'folder' | 'note', folderId: string | null = null) => ({ id, kind, folderId });

describe('arrangeItems', () => {
  test('puts items in their folder and keeps order', () => {
    const r = arrangeItems([it('f', 'folder'), it('a', 'link', 'f'), it('b', 'link'), it('c', 'link', 'f')]);
    expect(r.top.map((i) => i.id)).toEqual(['f', 'b']);
    expect(r.inFolder.get('f')!.map((i) => i.id)).toEqual(['a', 'c']);
  });

  test('an item whose folder is missing stays at the top', () => {
    const r = arrangeItems([it('a', 'link', 'gone'), it('b', 'link')]);
    expect(r.top.map((i) => i.id)).toEqual(['a', 'b']);
  });

  test('folders never nest, and pointing at a non-folder does nothing', () => {
    const r = arrangeItems([it('f', 'folder'), it('g', 'folder', 'f'), it('n', 'note'), it('a', 'link', 'n')]);
    expect(r.top.map((i) => i.id)).toEqual(['f', 'g', 'n', 'a']);
    expect(r.inFolder.get('f')).toEqual([]);
    expect(r.inFolder.get('g')).toEqual([]);
  });
});
