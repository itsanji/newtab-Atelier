import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb, type AtelierDB } from '../data/db';
import { exportAll } from '../data/exportImport';
import { createCategory, createItem, createWorkspace } from '../data/repo';
import { ensureSeed } from '../data/seed';
import { App } from '../newtab/App';

let fake: ChromeFake;
let db: AtelierDB;
beforeEach(() => {
  // jsdom's File has no text(); browsers do.
  File.prototype.text ??= function (this: File) { return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(this); }); };
  fake = installChromeFake();
  db = openDb('test-' + crypto.randomUUID());
});

test('Data menu imports a chosen file and announces the summary', async () => {
  const user = userEvent.setup();
  const src = openDb('test-' + crypto.randomUUID());
  const ws = await createWorkspace(src, { name: 'Elsewhere' });
  const cat = await createCategory(src, { workspaceId: ws.id, name: 'Frames' });
  await createItem(src, { categoryId: cat.id, kind: 'link', title: 'Moulding', url: 'https://m.test' });
  const json = JSON.stringify(await exportAll(src));
  await ensureSeed(db);
  const before = await db.workspaces.count();
  const { container } = render(<App db={db} />);
  await user.click(await screen.findByRole('button', { name: 'Data' }));
  expect(screen.getByRole('menuitem', { name: 'Export data' })).toBeInTheDocument();
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
  await user.click(screen.getByRole('menuitem', { name: 'Import data' }));
  expect(click).toHaveBeenCalled();
  click.mockRestore();
  const file = new File([json], 'x.json', { type: 'application/json' });
  await user.upload(container.querySelector<HTMLInputElement>('input[type=file]')!, file);
  expect(await screen.findByText('Added 3, updated 0, skipped 0')).toBeInTheDocument();
  await waitFor(async () => expect(await db.workspaces.count()).toBe(before + 1));
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'reminders-changed' });
});

test('Data menu reports a file that is not an export', async () => {
  const user = userEvent.setup();
  await ensureSeed(db);
  const { container } = render(<App db={db} />);
  await screen.findByRole('button', { name: 'Data' });
  await user.upload(container.querySelector<HTMLInputElement>('input[type=file]')!, new File(['nope'], 'x.json', { type: 'application/json' }));
  expect(await screen.findByText("This file isn't an Atelier export")).toBeInTheDocument();
});
