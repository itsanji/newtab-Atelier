import type { Workspace } from '@atelier/core';
import { Dabs } from '../ui/components/Dabs';
import { WorkspaceList } from './WorkspaceList';

export function Sidebar({ workspaces, selectedId, onSelect }: { workspaces: Workspace[]; selectedId: string; onSelect(id: string): void }) {
  return (
    <aside className="atl-sidebar">
      <div className="atl-brand">
        <span className="atl-brand-name">Atelier</span>
        <Dabs />
      </div>
      <WorkspaceList workspaces={workspaces} selectedId={selectedId} onSelect={onSelect} />
      <section aria-label="Open tabs" data-slot="open-tabs" hidden />
    </aside>
  );
}
