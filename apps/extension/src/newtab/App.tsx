import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { openDb, type AtelierDB } from '../data/db';
import { DbProvider } from '../data/DbContext';
import { getMeta, liveWorkspaces, setMeta } from '../data/queries';
import { ensureSeed } from '../data/seed';
import { NoticeProvider, useRun } from '../board/Notice';
import { Board } from '../board/Board';
import { BoardHeader } from '../board/BoardHeader';
import { BoardDnd } from '../board/dnd';
import { Sidebar } from '../board/Sidebar';
import { useHighlightItem } from '../board/useHighlightItem';

const SELECTED_KEY = 'selectedWorkspaceId';
let defaultDb: AtelierDB | undefined;

function Shell({ db }: { db: AtelierDB }) {
  const run = useRun();
  const workspaces = useLiveQuery(() => liveWorkspaces(db), [db]);
  // `null` means "no choice stored"; `undefined` means "still loading".
  const stored = useLiveQuery(async () => (await getMeta<string>(db, SELECTED_KEY)) ?? null, [db]);
  const highlight = useHighlightItem();
  const focused = useRef(false);
  useEffect(() => {
    if (focused.current) return;
    focused.current = true;
    const itemId = new URLSearchParams(window.location.search).get('item');
    if (!itemId) return;
    void (async () => {
      const item = await db.items.get(itemId);
      const category = item && item.deletedAt === null ? await db.categories.get(item.categoryId) : undefined;
      if (category && category.deletedAt === null) {
        await run(setMeta(db, SELECTED_KEY, category.workspaceId));
        highlight(itemId);
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('item');
      window.history.replaceState(null, '', url);
    })();
  }, [db, run, highlight]);
  if (!workspaces || stored === undefined) return null;
  const selected = workspaces.find((w) => w.id === stored) ?? workspaces[0];
  if (!selected) return null;
  return (
    <BoardDnd>
    <div className="atl-shell">
      <Sidebar workspaces={workspaces} selectedId={selected.id} onSelect={(id) => void run(setMeta(db, SELECTED_KEY, id))} />
      <main className="atl-main">
        <BoardHeader workspace={selected} />
        <Board key={selected.id} workspace={selected} />
      </main>
    </div>
    </BoardDnd>
  );
}

export function App({ db }: { db?: AtelierDB }) {
  const [resolved] = useState(() => db ?? (defaultDb ??= openDb()));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void ensureSeed(resolved).then(() => live && setReady(true));
    return () => { live = false; };
  }, [resolved]);
  if (!ready) return null;
  return (
    <DbProvider db={resolved}>
      <NoticeProvider>
        <Shell db={resolved} />
      </NoticeProvider>
    </DbProvider>
  );
}
