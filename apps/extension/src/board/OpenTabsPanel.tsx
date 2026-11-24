import { useEffect, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { faviconUrl } from '../chrome/favicon';
import { listWindowTabs, saveAllAndClose } from '../chrome/tabs';
import { useDb } from '../data/DbContext';
import { Button } from '../ui/components/Button';
import { useNotify, useRun } from './Notice';

function TabRow({ tab }: { tab: chrome.tabs.Tab }) {
  const title = tab.title || tab.url || 'Untitled';
  const [broken, setBroken] = useState(false);
  const d = useDraggable({ id: `tab:${tab.id}`, data: { type: 'tab', title, tab: { url: tab.url, title: tab.title } } });
  return (
    <li
      ref={d.setNodeRef}
      className="atl-tabrow"
      style={{ opacity: d.isDragging ? 0.4 : undefined }}
      {...d.attributes}
      {...d.listeners}
    >
      <svg aria-hidden="true" width="14" height="20" viewBox="0 0 14 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="atl-tabrow-grip">
        <path d="M5 5h0M9 5h0M5 10h0M9 10h0M5 15h0M9 15h0" />
      </svg>
      <span className="atl-tabrow-fav">
        {broken ? title.charAt(0).toUpperCase() : <img src={faviconUrl(tab.url ?? '', 16)} alt="" width={16} height={16} onError={() => setBroken(true)} />}
      </span>
      <span className="atl-tabrow-title" title={title}>{title}</span>
    </li>
  );
}

export function OpenTabsPanel({ workspaceId }: { workspaceId: string }) {
  const db = useDb();
  const run = useRun();
  const notify = useNotify();
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let live = true;
    const refresh = () => void listWindowTabs().then((t) => live && setTabs(t));
    const schedule = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(refresh, 100);
    };
    refresh();
    const events = [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved];
    for (const e of events) e.addListener(schedule);
    return () => {
      live = false;
      clearTimeout(timer.current);
      for (const e of events) e.removeListener(schedule);
    };
  }, []);

  const saveAll = async () => {
    let saved = 0;
    if (await run(saveAllAndClose(db, workspaceId).then((r) => { saved = r.saved; }))) {
      notify(saved === 0 ? 'Nothing to save' : `Saved ${saved} ${saved === 1 ? 'tab' : 'tabs'}`);
    }
  };

  return (
    <section aria-label="Open tabs" className="atl-opentabs">
      <div className="atl-opentabs-head">
        <p className="im-eyebrow">Open now</p>
        <span className="atl-opentabs-count">{tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}</span>
      </div>
      <p className="atl-opentabs-hint">Drag a tab onto the board to keep it.</p>
      <ul className="atl-opentabs-list">
        {tabs.map((t) => <TabRow key={t.id} tab={t} />)}
      </ul>
      <Button variant="primary" disabled={tabs.length === 0} onClick={() => void saveAll()}>
        {tabs.length === 0 ? 'Nothing to save' : `Save all ${tabs.length} and close`}
      </Button>
    </section>
  );
}
