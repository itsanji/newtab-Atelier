import {
  exportFileSchema, keyBetween, type Category, type ExportFile, type Item, type Reminder, type Workspace,
} from '@atelier/core';
import { LOCAL_USER, type AtelierDB } from './db';
import { clock, save, tx, type Row } from './repo';

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const NOT_EXPORT = "This file isn't an Atelier export";
const DAMAGED = 'This export has damaged entries';
const IMPORTED = 'Imported';

export interface ImportResult { added: number; updated: number; skipped: number }

/** Live rows only; reminders only for live items. */
export async function exportAll(db: AtelierDB): Promise<ExportFile> {
  return db.transaction('r', [db.workspaces, db.categories, db.items, db.reminders], async () => {
    const live = <R extends { deletedAt: string | null }>(r: R) => r.deletedAt === null;
    const items = (await db.items.toArray()).filter(live);
    const itemIds = new Set(items.map((i) => i.id));
    return {
      format: 'atelier', version: 1, exportedAt: clock.now(),
      workspaces: (await db.workspaces.toArray()).filter(live),
      categories: (await db.categories.toArray()).filter(live),
      items,
      reminders: (await db.reminders.toArray()).filter((r) => live(r) && itemIds.has(r.itemId)),
    };
  });
}

/** Parse the text of a chosen file; throws ImportError when it is not JSON. */
export function parseExportText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportError(NOT_EXPORT);
  }
}

function validate(json: unknown): ExportFile {
  const head = json as { format?: unknown; version?: unknown } | null;
  if (typeof head !== 'object' || head === null || head.format !== 'atelier' || head.version !== 1) {
    throw new ImportError(NOT_EXPORT);
  }
  const parsed = exportFileSchema.safeParse(json);
  if (!parsed.success) throw new ImportError(DAMAGED);
  return parsed.data as ExportFile;
}

const bySortKey = <T extends { id: string; sortKey: string }>(rows: T[]) =>
  [...rows].sort((a, b) => (a.sortKey === b.sortKey ? (a.id < b.id ? -1 : 1) : a.sortKey < b.sortKey ? -1 : 1));

export async function importFile(db: AtelierDB, json: unknown): Promise<ImportResult> {
  const file = validate(json);
  return tx(db, async () => {
    const now = clock.now();
    const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
    const finalState = {
      workspaces: new Map<string, Workspace>((await db.workspaces.toArray()).map((r) => [r.id, r])),
      categories: new Map<string, Category>((await db.categories.toArray()).map((r) => [r.id, r])),
      items: new Map<string, Item>((await db.items.toArray()).map((r) => [r.id, r])),
      reminders: new Map<string, Reminder>((await db.reminders.toArray()).map((r) => [r.id, r])),
    };
    const written = { workspaces: [] as Workspace[], categories: [] as Category[], items: [] as Item[], reminders: [] as Reminder[] };

    // Decide which incoming rows win; nothing is written until parents are known.
    const merge = <R extends Row>(rows: R[], map: Map<string, R>, out: R[]) => {
      for (const row of rows) {
        const cur = map.get(row.id);
        if (cur && !(row.updatedAt > cur.updatedAt)) { result.skipped++; continue; }
        if (cur) result.updated++; else result.added++;
        map.set(row.id, row);
        out.push(row);
      }
    };
    merge(file.workspaces, finalState.workspaces, written.workspaces);
    merge(file.categories, finalState.categories, written.categories);
    merge(file.items, finalState.items, written.items);

    const parentOk = <P extends Row>(map: Map<string, P>, id: string) => {
      const p = map.get(id);
      return !!p && p.deletedAt === null;
    };
    const orphanCats = written.categories.filter((c) => c.deletedAt === null && !parentOk(finalState.workspaces, c.workspaceId));
    const orphanItems = written.items.filter((i) => i.deletedAt === null && !parentOk(finalState.categories, i.categoryId));

    let importedWs: Workspace | undefined;
    let importedCat: Category | undefined;
    const liveSorted = <T extends { id: string; sortKey: string; deletedAt: string | null }>(rows: Iterable<T>) =>
      bySortKey([...rows].filter((r) => r.deletedAt === null));
    const stamp = { updatedAt: now, updatedBy: LOCAL_USER };
    const mk = { createdAt: now, deletedAt: null, ...stamp };
    const put = async <R extends Row>(table: 'workspaces' | 'categories' | 'items' | 'reminders', row: R) => {
      await save(db, table, row, now);
    };

    const ensureImportedWs = async (): Promise<Workspace> => {
      if (importedWs) return importedWs;
      const all = liveSorted(finalState.workspaces.values());
      importedWs = all.find((w) => w.name === IMPORTED);
      if (!importedWs) {
        importedWs = {
          ...mk, id: crypto.randomUUID(), name: IMPORTED, emoji: null, ownerId: null,
          sortKey: keyBetween(all.at(-1)?.sortKey ?? null, null),
        };
        finalState.workspaces.set(importedWs.id, importedWs);
        await put('workspaces', importedWs);
      }
      return importedWs;
    };
    const ensureImportedCat = async (): Promise<Category> => {
      if (importedCat) return importedCat;
      const ws = await ensureImportedWs();
      const all = liveSorted([...finalState.categories.values()].filter((c) => c.workspaceId === ws.id));
      importedCat = all.find((c) => c.name === IMPORTED);
      if (!importedCat) {
        importedCat = {
          ...mk, id: crypto.randomUUID(), workspaceId: ws.id, name: IMPORTED, emoji: null,
          sortKey: keyBetween(all.at(-1)?.sortKey ?? null, null), tabGroup: null, shareToken: null,
        };
        finalState.categories.set(importedCat.id, importedCat);
        await put('categories', importedCat);
      }
      return importedCat;
    };

    // Re-parent orphans, appended at the end of their new parent in original relative order.
    if (orphanCats.length) {
      const ws = await ensureImportedWs();
      const orphanIds = new Set(orphanCats.map((c) => c.id));
      let tail = liveSorted([...finalState.categories.values()].filter((c) => c.workspaceId === ws.id && !orphanIds.has(c.id))).at(-1)?.sortKey ?? null;
      for (const c of bySortKey(orphanCats)) {
        tail = keyBetween(tail, null);
        const moved = { ...c, workspaceId: ws.id, sortKey: tail, ...stamp };
        finalState.categories.set(c.id, moved);
        written.categories[written.categories.indexOf(c)] = moved;
      }
    }
    if (orphanItems.length) {
      const cat = await ensureImportedCat();
      const orphanIds = new Set(orphanItems.map((i) => i.id));
      let tail = liveSorted([...finalState.items.values()].filter((i) => i.categoryId === cat.id && !orphanIds.has(i.id))).at(-1)?.sortKey ?? null;
      for (const i of bySortKey(orphanItems)) {
        tail = keyBetween(tail, null);
        const moved = { ...i, categoryId: cat.id, sortKey: tail, ...stamp };
        finalState.items.set(i.id, moved);
        written.items[written.items.indexOf(i)] = moved;
      }
    }

    // Reminders last: their item must exist once the merge is complete.
    const reminderRows: Reminder[] = [];
    for (const r of file.reminders) {
      const item = finalState.items.get(r.itemId);
      if (!item || (item.deletedAt !== null && r.deletedAt === null)) { result.skipped++; continue; }
      const cur = finalState.reminders.get(r.id);
      if (cur && !(r.updatedAt > cur.updatedAt)) { result.skipped++; continue; }
      if (cur) result.updated++; else result.added++;
      finalState.reminders.set(r.id, r);
      reminderRows.push(r);
    }

    for (const w of written.workspaces) await put('workspaces', w);
    for (const c of written.categories) await put('categories', c);
    for (const i of written.items) await put('items', i);
    for (const r of reminderRows) await put('reminders', r);
    return result;
  });
}
