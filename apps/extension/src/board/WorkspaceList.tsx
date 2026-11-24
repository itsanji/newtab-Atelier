import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Workspace } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../data/repo';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Dialog';
import { Field } from '../ui/components/Field';
import { Icon } from '../ui/components/Icon';
import { Menu } from '../ui/components/Menu';
import { EmojiPicker } from './EmojiPicker';
import { useRun } from './Notice';
import { InlineNameField } from './InlineNameField';
import { useSavedCount } from './useSavedCount';

function WorkspaceRow({
  ws, selected, only, onSelect,
}: { ws: Workspace; selected: boolean; only: boolean; onSelect(): void }) {
  const db = useDb();
  const count = useSavedCount(ws.id);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const [name, setName] = useState(ws.name);
  const [nameError, setNameError] = useState<string>();
  const run = useRun();
  const drop = useDroppable({ id: ws.id, data: { type: 'workspace', title: ws.name } });
  const [emoji, setEmoji] = useState(ws.emoji ?? '');

  return (
    <div ref={drop.setNodeRef} className={['atl-ws', selected && 'atl-ws-active', drop.isOver && 'atl-ws-over'].filter(Boolean).join(' ')}>
      <button type="button" className="atl-ws-btn" aria-current={selected ? 'page' : undefined} onClick={onSelect}>
        <span>{ws.emoji && <span aria-hidden="true">{ws.emoji} </span>}{ws.name}</span>
        <span className="atl-ws-count">{count}</span>
      </button>
      <Menu
        trigger={<Icon name="more" size={18} />}
        triggerLabel="Workspace options"
        triggerClassName="atl-icon"
        items={[
          { label: 'Edit', onSelect: () => { setName(ws.name); setEmoji(ws.emoji ?? ''); setNameError(undefined); setDialog('edit'); } },
          { label: 'Delete', danger: true, disabled: only, hint: only ? 'Keep at least one workspace' : undefined, onSelect: () => setDialog('delete') },
        ]}
      />
      <Dialog open={dialog === 'edit'} title="Edit workspace" onClose={() => setDialog(null)}>
        <form
          className="atl-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const n = name.trim();
            if (!n) { setNameError('Give the workspace a name'); return; }
            await run(updateWorkspace(db, ws.id, { name: n, emoji: emoji.trim() || null }));
            setDialog(null);
          }}
        >
          <Field label="Name" value={name} error={nameError} autoFocus onChange={(e) => { setName(e.target.value); setNameError(undefined); }} />
          <div className="atl-emoji-row">
            <span className="im-label" id={`emoji-label-${ws.id}`}>Emoji (optional)</span>
            <EmojiPicker labelledBy={`emoji-label-${ws.id}`} value={emoji || null} onChange={(e) => setEmoji(e ?? '')} />
          </div>
          <div className="atl-form-actions">
            <Button type="submit">Save workspace</Button>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={dialog === 'delete'} title="Delete this workspace?" returnFocusTo={() => document.querySelector<HTMLElement>('.atl-ws-btn[aria-current]')} onClose={() => setDialog(null)}>
        <p>Its categories and saved items go with it.</p>
        <div className="atl-form-actions">
          <Button
            variant="danger"
            onClick={async () => {
              await run(deleteWorkspace(db, ws.id));
              setDialog(null);
            }}
          >
            Delete workspace
          </Button>
          <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
        </div>
      </Dialog>
    </div>
  );
}

export function WorkspaceList({
  workspaces, selectedId, onSelect,
}: { workspaces: Workspace[]; selectedId: string; onSelect(id: string): void }) {
  const db = useDb();
  const run = useRun();
  const [adding, setAdding] = useState(false);

  return (
    <nav aria-label="Workspaces" className="atl-workspaces">
      <p className="im-eyebrow">Workspaces</p>
      {workspaces.map((ws) => (
        <WorkspaceRow key={ws.id} ws={ws} selected={ws.id === selectedId} only={workspaces.length <= 1} onSelect={() => onSelect(ws.id)} />
      ))}
      {adding ? (
        <InlineNameField
          label="Workspace name"
          commitOnBlur={false}
          submitLabel="Create workspace"
          placeholder="Name this workspace"
          onCancel={() => setAdding(false)}
          onCommit={async (name) => {
            setAdding(false);
            if (!name) return;
            try { onSelect((await createWorkspace(db, { name })).id); } catch (e) { void run(Promise.reject(e)); }
          }}
        />
      ) : (
        <Button variant="ghost" onClick={() => setAdding(true)}>+ New workspace</Button>
      )}
    </nav>
  );
}
