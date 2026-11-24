import { useEffect, useState } from 'react';
import type { Category, Workspace } from '@atelier/core';
import { openDb, type AtelierDB } from '../data/db';
import { DbProvider, useDb } from '../data/DbContext';
import { getMeta, liveCategories, liveWorkspaces, setMeta } from '../data/queries';
import { createCategory, createItem } from '../data/repo';
import { useTheme } from '../data/settings';
import { ensureSeed } from '../data/seed';
import { LAST_CATEGORY_KEY } from '../data/target';
import { faviconUrl } from '../chrome/favicon';
import { isSavableTab, listWindowTabs, saveAllAndClose } from '../chrome/tabs';
import { NoticeProvider, useRun } from '../board/Notice';
import { Button } from '../ui/components/Button';
import { Dabs } from '../ui/components/Dabs';
import { Field } from '../ui/components/Field';
import { Icon } from '../ui/components/Icon';

let defaultDb: AtelierDB | undefined;

interface Loaded {
  tab: chrome.tabs.Tab | undefined;
  workspace: Workspace;
  categories: Category[];
  selectedId: string | undefined;
  windowTabs: number;
  closeAfterSave: boolean;
}

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const param = new URLSearchParams(window.location.search).get('tabId');
  if (param) return chrome.tabs.get(Number(param));
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function load(db: AtelierDB): Promise<Loaded> {
  await ensureSeed(db);
  const workspaces = await liveWorkspaces(db);
  const storedWs = await getMeta<string>(db, 'selectedWorkspaceId');
  const workspace = workspaces.find((w) => w.id === storedWs) ?? workspaces[0]!;
  const categories = await liveCategories(db, workspace.id);
  const last = await getMeta<string>(db, LAST_CATEGORY_KEY);
  const tab = await currentTab();
  const stored = (await chrome.storage.local.get('closeAfterSave')).closeAfterSave;
  return {
    tab, workspace, categories,
    selectedId: categories.find((c) => c.id === last)?.id ?? categories[0]?.id,
    windowTabs: (await listWindowTabs(tab?.windowId)).length,
    closeAfterSave: typeof stored === 'boolean' ? stored : true,
  };
}

const hostPath = (url: string) => url.replace(/^https?:\/\//, '');

function PopupBody({ initial }: { initial: Loaded }) {
  useTheme();
  const db = useDb();
  const run = useRun();
  const { tab, workspace } = initial;
  const [categories, setCategories] = useState(initial.categories);
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [closeAfterSave, setCloseAfterSave] = useState(initial.closeAfterSave);
  const [note, setNote] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savable = !!tab && isSavableTab(tab);
  const selected = categories.find((c) => c.id === selectedId);

  const save = async () => {
    if (!tab || !selected || busy) return;
    setBusy(true);
    const ok = await run((async () => {
      await createItem(db, {
        categoryId: selected.id, kind: 'link', title: tab.title || tab.url || '', url: tab.url,
        faviconUrl: faviconUrl(tab.url ?? ''), note: note.trim() || null,
      });
      await setMeta(db, LAST_CATEGORY_KEY, selected.id);
      if (closeAfterSave && tab.id !== undefined) await chrome.tabs.remove(tab.id);
    })());
    setBusy(false);
    if (!ok) return;
    if (closeAfterSave) window.close();
    else setSaved(selected.name);
  };

  const saveAll = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await run(saveAllAndClose(db, workspace.id, tab?.windowId));
    setBusy(false);
    if (ok) window.close();
  };

  const addCategory = async () => {
    const name = newName.trim();
    if (!name) return;
    let made: Category | undefined;
    const ok = await run(createCategory(db, { workspaceId: workspace.id, name }).then((c) => { made = c; }));
    if (!ok || !made) return;
    setCategories((cs) => [...cs, made!]);
    setSelectedId(made.id);
    setAdding(false);
    setNewName('');
  };

  const toggleClose = (checked: boolean) => {
    setCloseAfterSave(checked);
    void chrome.storage.local.set({ closeAfterSave: checked });
  };

  return (
    <main className="atl-popup">
      <div className="atl-popup-head">
        <span className="atl-popup-brand">Atelier</span>
        <Dabs />
      </div>

      {tab && (
        <div className="atl-popup-tab">
          {tab.url && <img src={faviconUrl(tab.url)} alt="" />}
          <span className="atl-popup-tab-text">
            <span className="atl-popup-title">{tab.title || tab.url}</span>
            <span className="atl-popup-url">{hostPath(tab.url ?? '')}</span>
          </span>
        </div>
      )}

      <div className="atl-popup-section">
        <p className="im-eyebrow">Save to · {workspace.name}</p>
        <div role="radiogroup" aria-label="Category" className="atl-chips">
          {categories.map((c) => (
            <button
              key={c.id} type="button" role="radio" className="atl-chip"
              aria-checked={c.id === selectedId} onClick={() => setSelectedId(c.id)}
            >
              {c.name}
            </button>
          ))}
          {!adding && (
            <button type="button" role="radio" aria-checked={false} className="atl-chip atl-chip-new" onClick={() => setAdding(true)}>
              + New
            </button>
          )}
        </div>
        {adding && (
          <Field
            label="New category name" autoFocus value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void addCategory(); }
              if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); setNewName(''); }
            }}
          />
        )}
      </div>

      <Field label="Note (optional)" placeholder="Why you kept it" value={note} onChange={(e) => setNote(e.target.value)} />

      <label className="atl-check-row">
        <input type="checkbox" checked={closeAfterSave} onChange={(e) => toggleClose(e.target.checked)} />
        <span>Close the tab after saving</span>
      </label>

      <div className="atl-popup-actions">
        {!savable && <p className="atl-popup-hint">This page can't be saved</p>}
        {saved && (
          <p className="atl-popup-status" role="status"><Icon name="check" size={18} />Saved to {saved}</p>
        )}
        <Button variant="primary" disabled={!savable || !selected || busy} onClick={() => void save()}>Save tab</Button>
        {initial.windowTabs > 0 && (
          <Button disabled={busy} onClick={() => void saveAll()}>
            Save all {initial.windowTabs} {initial.windowTabs === 1 ? 'tab' : 'tabs'} in this window
          </Button>
        )}
        <a
          href="#" className="atl-popup-link"
          onClick={(e) => { e.preventDefault(); void chrome.tabs.create({}); window.close(); }}
        >
          Open the board
        </a>
      </div>
    </main>
  );
}

export function Popup({ db }: { db?: AtelierDB }) {
  const [resolved] = useState(() => db ?? (defaultDb ??= openDb()));
  const [initial, setInitial] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    void load(resolved).then((l) => live && setInitial(l));
    return () => { live = false; };
  }, [resolved]);
  if (!initial) return null;
  return (
    <DbProvider db={resolved}>
      <NoticeProvider>
        <PopupBody initial={initial} />
      </NoticeProvider>
    </DbProvider>
  );
}
