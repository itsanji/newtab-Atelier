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
    for (const rows of [workspaces, categories, items, reminders, members]) {
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
    };
  });
}
