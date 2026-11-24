import type { Workspace } from '@atelier/core';
import { useEffect, useState } from 'react';
import { useAccount } from '../account/account';
import { Button } from '../ui/components/Button';
import { Tag } from '../ui/components/Tag';
import { ShareDialog } from './ShareDialog';
import { useCurrentRole } from './useRole';
import { IconButton } from '../ui/components/IconButton';
import type { ThemePref, ResolvedTheme } from '../data/settings';
import { Field } from '../ui/components/Field';
import { useSavedCount } from './useSavedCount';

const SEARCH_ID = 'atl-search-input';

export function BoardHeader({
  workspace, query, onQueryChange, theme,
}: { workspace: Workspace; query: string; onQueryChange(q: string): void; theme: { pref: ThemePref; resolved: ResolvedTheme; cycle(): unknown } }) {
  const saved = useSavedCount(workspace.id);
  const account = useAccount();
  const role = useCurrentRole();
  const [sharing, setSharing] = useState(false);
  const { pref, resolved, cycle } = theme;
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
        {role === 'viewer' && <Tag>View only</Tag>}
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
        {account && (
          <div data-slot="share">
            <Button onClick={() => setSharing(true)}>Share</Button>
            <ShareDialog key={workspace.id} workspace={workspace} account={account} open={sharing} onClose={() => setSharing(false)} />
          </div>
        )}
      </div>
    </header>
  );
}
