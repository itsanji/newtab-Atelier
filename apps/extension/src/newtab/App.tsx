import { useBoardView } from '../data/boardView';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { AtelierDB } from '../data/db';
import { DbProvider, useDb } from '../data/DbContext';
import { useAccount } from '../account/useAccount';
import { useLiveSync } from '../sync/live';
import { ActiveDbProvider } from '../account/ActiveDbProvider';
import { buildIndex, search } from '../data/search';
import { SearchResults } from '../board/SearchResults';
import { getMeta, liveWorkspaces, setMeta } from '../data/queries';
import { useTheme } from '../data/settings';
import { ensureSeed } from '../data/seed';
import { NoticeProvider, useRun } from '../board/Notice';
import { Board } from '../board/Board';
import { BoardHeader } from '../board/BoardHeader';
import { BoardDnd } from '../board/dnd';
import { Sidebar } from '../board/Sidebar';
import { useHighlightItem } from '../board/useHighlightItem';
import { AccountEntry } from '../board/AccountDialog';
import { RoleProvider } from '../board/useRole';
import { useRecoveredNotice } from '../board/useRecovered';
import { CURSOR_KEY } from '../sync/engine';

const SELECTED_KEY = 'selectedWorkspaceId';

function Shell({ db }: { db: AtelierDB }) {
  const theme = useTheme();
  const run = useRun();
  const workspaces = useLiveQuery(() => liveWorkspaces(db), [db]);
  // `null` means "no choice stored"; `undefined` means "still loading".
  const stored = useLiveQuery(async () => (await getMeta<string>(db, SELECTED_KEY)) ?? null, [db]);
  const highlight = useHighlightItem();
  useRecoveredNotice();
  const [query, setQuery] = useState('');
  const [view, setView] = useBoardView();
  const trimmed = query.trim();
  // Rows are read and indexed only while there is something to search for.
  const searching = trimmed !== '';
  const rows = useLiveQuery(async () => (searching ? {
    workspaces: await db.workspaces.filter((r) => r.deletedAt === null).toArray(),
    categories: await db.categories.filter((r) => r.deletedAt === null).toArray(),
    items: await db.items.filter((r) => r.deletedAt === null).toArray(),
  } : null), [db, searching]);
  const index = useMemo(() => (rows ? buildIndex(rows) : null), [rows]);
  const hits = useMemo(() => (index && trimmed ? search(index, trimmed) : []), [index, trimmed]);
  const urls = useMemo(() => new Map((rows?.items ?? []).flatMap((i) => (i.url ? [[i.id, i.url] as const] : []))), [rows]);
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
      <RoleProvider workspaceId={selected.id}>
      <main className="atl-main">
        <BoardHeader workspace={selected} query={query} onQueryChange={setQuery} theme={theme} view={view} onViewChange={setView} />
        {trimmed ? (
          // Until the index is ready there is nothing to show, rather than a false "no results".
          index && <SearchResults
            query={trimmed}
            hits={hits}
            urls={urls}
            onPick={(hit) => {
              setQuery('');
              void run(setMeta(db, SELECTED_KEY, hit.workspaceId)).then(() => highlight(hit.itemId));
            }}
          />
        ) : (
          <Board key={selected.id} workspace={selected} view={view} />
        )}
      </main>
      </RoleProvider>
    </div>
    </BoardDnd>
  );
}

function LiveSync() {
  useLiveSync(useAccount());
  return null;
}

function Ready() {
  const db = useDb();
  const account = useAccount();
  const state = useLiveQuery(async () => ({
    hasWorkspaces: (await db.workspaces.count()) > 0,
    pulled: (await getMeta(db, CURSOR_KEY)) !== undefined,
  }), [db]);
  // A signed-in board gets its starter workspace only after the first pull found none on the server.
  const waitForPull = !!account && !!state && !state.hasWorkspaces && !state.pulled;
  useEffect(() => {
    if (account === undefined || !state || state.hasWorkspaces || waitForPull) return;
    void ensureSeed(db).catch((e: unknown) => console.error(e));
  }, [db, account, state, waitForPull]);
  if (account === undefined || !state) return null;
  if (waitForPull) {
    return (
      <div className="atl-waiting" role="status">
        <LiveSync />
        <p>Getting your board from the server…</p>
        <AccountEntry />
      </div>
    );
  }
  if (!state.hasWorkspaces) return null;
  return (
    <NoticeProvider>
      <LiveSync />
      <Shell db={db} />
    </NoticeProvider>
  );
}

/** `db` is for tests; without it the active account's partition is opened. */
export function App({ db }: { db?: AtelierDB }) {
  return db ? <DbProvider db={db}><Ready /></DbProvider> : <ActiveDbProvider><Ready /></ActiveDbProvider>;
}
