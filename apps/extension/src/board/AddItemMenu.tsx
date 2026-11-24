import { useState } from 'react';
import { useDb } from '../data/DbContext';
import { createItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { useRun } from './Notice';
import { LinkForm } from './LinkForm';

export function AddItemMenu({ categoryId }: { categoryId: string }) {
  const db = useDb();
  const run = useRun();
  const [adding, setAdding] = useState<'link' | null>(null);

  if (adding === 'link') {
    return (
      <LinkForm
        submitLabel="Add link"
        onCancel={() => setAdding(null)}
        onSubmit={async ({ url, title }) => {
          await run(createItem(db, { categoryId, kind: 'link', title, url }));
          setAdding(null);
        }}
      />
    );
  }
  return (
    <Menu
      trigger={<><Icon name="plus" size={16} /> Add</>}
      triggerClassName="im-btn im-btn-ghost"
      items={[{ label: 'Link', onSelect: () => setAdding('link') }]}
    />
  );
}
