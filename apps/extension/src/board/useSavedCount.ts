import { useLiveQuery } from 'dexie-react-hooks';
import { useDb } from '../data/DbContext';
import { liveCategories, liveItems } from '../data/queries';

/** Live count of saved items (links, notes, to-dos) in a workspace. */
export function useSavedCount(workspaceId: string): number {
  const db = useDb();
  return (
    useLiveQuery(async () => {
      let n = 0;
      for (const c of await liveCategories(db, workspaceId)) n += (await liveItems(db, c.id)).length;
      return n;
    }, [db, workspaceId]) ?? 0
  );
}
