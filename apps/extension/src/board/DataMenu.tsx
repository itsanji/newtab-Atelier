import { useRef } from 'react';
import { useDb } from '../data/DbContext';
import { exportAll, importFile, ImportError, parseExportText } from '../data/exportImport';
import { Menu } from '../ui/components/Menu';
import type { AtelierDB } from '../data/db';
import { useNotify } from './Notice';

/** Save every live row of `db` as an Atelier export file (browser download). */
export async function downloadExport(db: AtelierDB): Promise<void> {
  const file = await exportAll(db);
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `atelier-export-${file.exportedAt.slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DataMenu() {
  const db = useDb();
  const notify = useNotify();
  const input = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    try {
      await downloadExport(db);
    } catch (e) {
      console.error(e);
      notify('Something went wrong. Try again.');
    }
  };

  const doImport = async (file: File) => {
    try {
      const r = await importFile(db, parseExportText(await file.text()));
      notify(`Added ${r.added}, updated ${r.updated}, skipped ${r.skipped}`);
      void Promise.resolve(chrome.runtime.sendMessage({ type: 'reminders-changed' })).catch(() => {});
    } catch (e) {
      if (e instanceof ImportError) notify(e.message);
      else {
        console.error(e);
        notify('Something went wrong. Try again.');
      }
    }
  };

  return (
    <div className="atl-data">
      <Menu
        trigger="Data"
        triggerLabel="Data"
        triggerClassName="im-btn im-btn-ghost"
        items={[
          { label: 'Export data', onSelect: () => void doExport() },
          { label: 'Import data', onSelect: () => input.current?.click() },
        ]}
      />
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Import file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void doImport(f);
        }}
      />
    </div>
  );
}
