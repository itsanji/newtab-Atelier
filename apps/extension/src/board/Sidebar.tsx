import type { Workspace } from '@atelier/core';
import { Dabs } from '../ui/components/Dabs';
import { AccountEntry } from './AccountDialog';
import { DataMenu } from './DataMenu';
import { SyncStatus } from './SyncStatus';
import { OpenTabsPanel } from './OpenTabsPanel';
import { WorkspaceList } from './WorkspaceList';

export function Sidebar({ workspaces, selectedId, onSelect }: { workspaces: Workspace[]; selectedId: string; onSelect(id: string): void }) {
  return (
    // On wide windows the sidebar rests as a thin strip and opens over the board on hover or keyboard focus.
    <aside className="atl-sidebar">
      <div className="atl-sidebar-rail" aria-hidden="true"><span /><span /><span /><span /></div>
      <div className="atl-sidebar-inner">
      <div className="atl-brand">
        <span className="atl-brand-name">Atelier</span>
        <Dabs />
      </div>
      <WorkspaceList workspaces={workspaces} selectedId={selectedId} onSelect={onSelect} />
      <OpenTabsPanel workspaceId={selectedId} />
      <DataMenu />
      <AccountEntry />
      <SyncStatus />
      </div>
    </aside>
  );
}
