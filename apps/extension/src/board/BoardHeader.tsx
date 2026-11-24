import type { Workspace } from '@atelier/core';
import { useEffect } from 'react';
import { IconButton } from '../ui/components/IconButton';
import { useTheme } from '../data/settings';
import { Field } from '../ui/components/Field';
import { useSavedCount } from './useSavedCount';

const SEARCH_ID = 'atl-search-input';

export function BoardHeader({
  workspace, query, onQueryChange,
}: { workspace: Workspace; query: string; onQueryChange(q: string): void }) {
  const saved = useSavedCount(workspace.id);
  const { pref, resolved, cycle } = useTheme();
  const themeName = pref === 'system' ? 'System' : pref === 'nocturne' ? 'Nocturne' : 'Giverny';
  const themeIcon = pref === 'system' ? 'contrast' : resolved === 'nocturne' ? 'sun' : 'moon';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select') || t.isContentEditable)) return;
      e.preventDefault();
      document.getElementById(SEARCH_ID)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className="atl-header">
      <div className="atl-header-title">
        <p className="im-eyebrow">Workspace · {saved} saved</p>
        <h1>{workspace.name}</h1>
      </div>
      <div className="atl-header-slots">
        <div data-slot="search">
          <Field
            id={SEARCH_ID}
            className="atl-search"
            label="Search"
            hideLabel
            type="search"
            placeholder="Search saved tabs and notes"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onQueryChange(''); } }}
          />
        </div>
        <IconButton label={`Theme: ${themeName}`} icon={themeIcon} onClick={() => void cycle()} />
        <div data-slot="share" hidden />
      </div>
    </header>
  );
}
