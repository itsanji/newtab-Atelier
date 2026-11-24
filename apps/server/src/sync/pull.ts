import type { SQL } from 'bun';
import type { Category, Item, Reminder, Workspace } from '@atelier/core';
import { categoryToWire, itemToWire, memberToWire, reminderToWire, workspaceToWire, type Member } from './rows';

export interface PullResponse {
  cursor: number;
  workspaces: Workspace[];
  categories: Category[];
  items: Item[];
  reminders: Reminder[];
  members: Member[];
  removedWorkspaceIds: string[];
  /** Rows moved out of a visible workspace into one the caller cannot see: delete them locally. */
  goneRows: GoneRow[];
}

export interface GoneRow {
  table: 'categories' | 'items';
  id: string;
}

/**
 * Everything the caller may see that changed after `cursor`. Runs in one repeatable-read snapshot: pushes
 * take versions under an exclusive lock, so a snapshot holds either all of a push or none of it, and every
 * version committed later is higher than anything in the snapshot.
 */
export async function pull(sql: SQL, userId: string, cursor: number): Promise<PullResponse> {
  return sql.begin('isolation level repeatable read read only', async (tx) => {
    const memberships = await tx`select workspace_id, version, deleted_at from workspace_members where user_id = ${userId}`;
    const visible: string[] = [];
    const full: string[] = [];
    const removed: string[] = [];
    let max = cursor;
    for (const m of memberships) {
      const version = Number(m.version);
      if (m.deleted_at === null) {
        visible.push(m.workspace_id);
        // Newly shared (or re-shared) with the caller: send the whole workspace whatever its rows' versions.
        if (version > cursor) full.push(m.workspace_id);
      } else if (version > cursor) {
        removed.push(m.workspace_id);
        max = Math.max(max, version);
      }
    }
    const removedWorkspaceIds = removed.filter((id) => !visible.includes(id));

    const [workspaces, categories, items, reminders, members] = [
      await tx`select * from workspaces
        where id = any(${visible}::uuid[]) and (version > ${cursor} or id = any(${full}::uuid[]))
        order by version`,
      await tx`select * from categories
        where workspace_id = any(${visible}::uuid[]) and (version > ${cursor} or workspace_id = any(${full}::uuid[]))
        order by version`,
      await tx`select i.* from items i join categories c on c.id = i.category_id
        where c.workspace_id = any(${visible}::uuid[]) and (i.version > ${cursor} or c.workspace_id = any(${full}::uuid[]))
        order by i.version`,
      await tx`select * from reminders where user_id = ${userId} and version > ${cursor} order by version`,
      await tx`select m.*, u.display_name from workspace_members m left join users u on u.id = m.user_id
        where m.workspace_id = any(${visible}::uuid[]) and (m.version > ${cursor} or m.workspace_id = any(${full}::uuid[]))
        order by m.version`,
    ];
    // Moves out of a visible workspace whose row now sits in a workspace the caller cannot see.
    const moves = await tx`
      with moves as (
        select table_name, row_id, max(version) as version from row_moves
        where version > ${cursor} and from_workspace_id = any(${visible}::uuid[])
        group by table_name, row_id
      )
      select m.table_name, m.row_id, m.version from moves m
        left join categories c on m.table_name = 'categories' and c.id = m.row_id
        left join items i on m.table_name = 'items' and i.id = m.row_id
        left join categories ic on ic.id = i.category_id
      where not (coalesce(c.workspace_id, ic.workspace_id) = any(${visible}::uuid[]))
      order by m.version`;
    const gone = new Map<string, GoneRow>();
    for (const m of moves) gone.set(`${m.table_name}:${m.row_id}`, { table: m.table_name, id: m.row_id });
    const goneCategoryIds = moves.filter((m: { table_name: string }) => m.table_name === 'categories').map((m: { row_id: string }) => m.row_id);
    if (goneCategoryIds.length > 0) {
      // A category that left takes its items with it.
      const orphans = await tx`select id from items where category_id = any(${goneCategoryIds}::uuid[])`;
      for (const o of orphans) gone.set(`items:${o.id}`, { table: 'items', id: o.id });
    }

    for (const rows of [workspaces, categories, items, reminders, members, moves]) {
      for (const r of rows) max = Math.max(max, Number(r.version));
    }

    return {
      cursor: max,
      workspaces: workspaces.map(workspaceToWire),
      categories: categories.map(categoryToWire),
      items: items.map(itemToWire),
      reminders: reminders.map(reminderToWire),
      members: members.map(memberToWire),
      removedWorkspaceIds,
      goneRows: [...gone.values()],
    };
  });
}
