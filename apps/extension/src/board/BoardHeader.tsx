import type { Workspace } from '@atelier/core';
import { useSavedCount } from './useSavedCount';

export function BoardHeader({ workspace }: { workspace: Workspace }) {
  const saved = useSavedCount(workspace.id);
  return (
    <header className="atl-header">
      <div className="atl-header-title">
        <p className="im-eyebrow">Workspace · {saved} saved</p>
        <h1>{workspace.name}</h1>
      </div>
      <div className="atl-header-slots">
        <div data-slot="search" />
        <div data-slot="share" hidden />
      </div>
    </header>
  );
}
