import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Workspace } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { liveCategories } from '../data/queries';
import { createCategory } from '../data/repo';
import { InlineNameField } from './InlineNameField';
import { Icon } from '../ui/components/Icon';
import { CategoryColumn } from './CategoryColumn';

export function Board({ workspace }: { workspace: Workspace }) {
  const db = useDb();
  const categories = useLiveQuery(() => liveCategories(db, workspace.id), [db, workspace.id]) ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <div className="atl-board">
      {categories.map((c) => <CategoryColumn key={c.id} category={c} />)}
      <div className="atl-newcat">
        {adding ? (
          <InlineNameField
            label="Category name"
            placeholder="Name this category"
            onCancel={() => setAdding(false)}
            onCommit={(name) => {
              setAdding(false);
              if (name) void createCategory(db, { workspaceId: workspace.id, name });
            }}
          />
        ) : (
          <button type="button" className="atl-newcat-btn" onClick={() => setAdding(true)}>
            <Icon name="plus" size={24} />
            <span className="atl-newcat-title">New category</span>
            <span className="atl-newcat-hint">Or drop tabs here to start one</span>
          </button>
        )}
      </div>
    </div>
  );
}
