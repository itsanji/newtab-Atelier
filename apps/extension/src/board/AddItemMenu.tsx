import { useState } from 'react';
import { useDb } from '../data/DbContext';
import { createItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { useRun } from './Notice';
import { LinkForm } from './LinkForm';
import { InlineNameField } from './InlineNameField';

export function AddItemMenu({ categoryId, onCreated }: { categoryId: string; onCreated?(id: string): void }) {
  const db = useDb();
  const run = useRun();
  const [adding, setAdding] = useState<'link' | 'todo' | null>(null);

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
  if (adding === 'todo') {
    // Created only once it has text, so no empty to-do is ever left behind.
    return (
      <InlineNameField
        label="To-do text"
        placeholder="What needs doing"
        onCancel={() => setAdding(null)}
        onCommit={(text) => {
          setAdding(null);
          if (text) void run(createItem(db, { categoryId, kind: 'todo', title: text }));
        }}
      />
    );
  }
  const addNote = async () => {
    let id: string | undefined;
    await run(createItem(db, { categoryId, kind: 'note', title: '', body: null }).then((i) => { id = i.id; }));
    if (id) onCreated?.(id);
  };
  return (
    <Menu
      trigger={<><Icon name="plus" size={16} /> Add</>}
      triggerClassName="im-btn im-btn-ghost"
      items={[
        { label: 'Link', onSelect: () => setAdding('link') },
        { label: 'Note', onSelect: () => void addNote() },
        { label: 'To-do', onSelect: () => setAdding('todo') },
      ]}
    />
  );
}
