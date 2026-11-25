import { useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import type { Item } from '@atelier/core';
import { useDb } from '../data/DbContext';
import { deleteItem, updateItem } from '../data/repo';
import { Menu } from '../ui/components/Menu';
import { Icon } from '../ui/components/Icon';
import { useRun } from './Notice';
import { removeAndRefocus } from './removeItem';
import { Tag } from '../ui/components/Tag';
import { useSortableItem } from './dnd';
import { useCanEdit } from './useRole';

type Node = { type?: string; text?: string; content?: Node[] };

const textOf = (n: Node): string => n.text ?? (n.content ?? []).map(textOf).join('');

/** Plain text of the first non-empty textblock, trimmed, at most 80 characters. */
export function deriveTitle(doc: Node | null): string {
  const walk = (n: Node): string | null => {
    const kids = n.content ?? [];
    if (kids.length && kids.every((k) => k.type === 'text' || k.type === 'hardBreak')) {
      const t = textOf(n).trim();
      return t || null;
    }
    for (const k of kids) {
      const t = walk(k);
      if (t) return t;
    }
    return null;
  };
  return (doc ? walk(doc) ?? '' : '').slice(0, 80);
}

const DEBOUNCE_MS = 400;

export function NoteItem({ item, autoFocus = false, onAutoFocused }: { item: Item; autoFocus?: boolean; onAutoFocused?(): void }) {
  const db = useDb();
  const run = useRun();
  const row = useRef<HTMLDivElement | null>(null);
  const canEdit = useCanEdit();
  const dnd = useSortableItem(item, false);
  const pending = useRef<Node | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const runRef = useRef(run);
  runRef.current = run;

  const flush = () => {
    clearTimeout(timer.current);
    const doc = pending.current;
    if (!doc) return;
    pending.current = null;
    void runRef.current(updateItem(db, item.id, { body: doc, title: deriveTitle(doc) }));
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    editable: canEdit,
    content: (item.body as Node | null) ?? '',
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': item.title ? `Note: ${item.title}` : 'New note', class: 'atl-note-editor' },
    },
    onUpdate: ({ editor: ed }) => {
      pending.current = ed.getJSON() as Node;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    onBlur: flush,
  });

  // Focus was requested once at creation; clear the request so a later remount does not steal focus.
  useEffect(() => {
    if (!autoFocus || !editor) return;
    editor.commands.focus('end');
    onAutoFocused?.();
  }, [autoFocus, editor, onAutoFocused]);

  useEffect(() => { editor?.setEditable(canEdit); }, [editor, canEdit]);

  // Keep the label current as the title changes (attributes are fixed at creation otherwise).
  useEffect(() => {
    editor?.setOptions({
      editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': item.title ? `Note: ${item.title}` : 'New note', class: 'atl-note-editor' } },
    });
  }, [editor, item.title]);

  // Never lose edits: flush when the tab hides or closes, and on unmount.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const now = () => flushRef.current();
    const onVisibility = () => { if (document.visibilityState === 'hidden') now(); };
    window.addEventListener('pagehide', now);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', now);
      document.removeEventListener('visibilitychange', onVisibility);
      now();
    };
  }, []);

  const remove = async () => {
    clearTimeout(timer.current);
    pending.current = null;
    await removeAndRefocus(row.current, () => run(deleteItem(db, item.id)));
  };

  return (
    <div className="atl-item atl-note" data-item-id={item.id} ref={(el) => { row.current = el; dnd.setNodeRef(el); }} style={dnd.style}>
      {dnd.handle}
      <div className="atl-note-well"><EditorContent editor={editor} /></div>
      {item.restored && <Tag tone="ochre">Restored</Tag>}
      {canEdit && <div className="atl-item-menu">
        <Menu
          trigger={<Icon name="more" size={18} />}
          triggerLabel="Note options"
          triggerClassName="atl-icon"
          items={[{ label: 'Delete', danger: true, onSelect: () => void remove() }]}
        />
      </div>}
    </div>
  );
}
