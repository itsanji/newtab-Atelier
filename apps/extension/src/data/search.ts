import MiniSearch from 'minisearch';
import type { Category, Item, ItemKind, Workspace } from '@atelier/core';
import { noteText } from './noteText';

export interface SearchHit {
  itemId: string;
  title: string;
  kind: ItemKind;
  categoryName: string;
  workspaceName: string;
  workspaceId: string;
  categoryId: string;
}

interface Doc {
  id: string;
  title: string;
  url: string;
  note: string;
  text: string;
  kind: ItemKind;
  categoryId: string;
  categoryName: string;
  workspaceId: string;
  workspaceName: string;
}

export function buildIndex(rows: { items: Item[]; categories: Category[]; workspaces: Workspace[] }): MiniSearch<Doc> {
  const index = new MiniSearch<Doc>({
    fields: ['title', 'url', 'note', 'text'],
    storeFields: ['title', 'kind', 'categoryId', 'categoryName', 'workspaceId', 'workspaceName'],
    searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
  });
  const workspaces = new Map(rows.workspaces.filter((w) => w.deletedAt === null).map((w) => [w.id, w]));
  const categories = new Map(rows.categories.filter((c) => c.deletedAt === null).map((c) => [c.id, c]));
  const docs: Doc[] = [];
  for (const item of rows.items) {
    if (item.deletedAt !== null) continue;
    const category = categories.get(item.categoryId);
    const workspace = category && workspaces.get(category.workspaceId);
    if (!category || !workspace) continue;
    docs.push({
      id: item.id,
      title: item.title,
      url: item.url ?? '',
      note: item.note ?? '',
      text: item.kind === 'note' ? noteText(item.body) : '',
      kind: item.kind,
      categoryId: category.id,
      categoryName: category.name,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    });
  }
  index.addAll(docs);
  return index;
}

export function search(index: MiniSearch<Doc>, query: string): SearchHit[] {
  if (!query.trim()) return [];
  return index.search(query).map((r) => ({
    itemId: r.id as string,
    title: r.title as string,
    kind: r.kind as ItemKind,
    categoryName: r.categoryName as string,
    workspaceName: r.workspaceName as string,
    workspaceId: r.workspaceId as string,
    categoryId: r.categoryId as string,
  }));
}
