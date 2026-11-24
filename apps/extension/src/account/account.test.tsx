import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { installChromeFake } from '../../test/chromeFake';
import { clearAccount, currentUserId, getAccount, partitionFor, setAccount, setCurrentUserId, type Account } from './account';
import { sha256Hex } from './sha256';
import { ActiveDbProvider, getActiveDb } from './activeDb';
import { useDb } from '../data/DbContext';
import { createCategory, createWorkspace, setReminder, createItem } from '../data/repo';
import { deleteDb } from '../data/db';

const acct = (userId: string, serverUrl = 'https://a.example'): Account => ({
  serverUrl, userId, email: `${userId}@x.io`, displayName: userId, token: 't', partition: partitionFor(serverUrl, userId),
});

beforeEach(() => { installChromeFake(); setCurrentUserId(null); });
afterEach(() => setCurrentUserId(null));

describe('partitionFor', () => {
  test('is stable and differs per user', () => {
    expect(partitionFor('https://a.example', 'u1')).toBe(partitionFor('https://a.example', 'u1'));
    expect(partitionFor('https://a.example', 'u1')).not.toBe(partitionFor('https://a.example', 'u2'));
    expect(partitionFor('https://a.example', 'u1')).not.toBe(partitionFor('https://b.example', 'u1'));
    expect(partitionFor('https://a.example', 'u1')).toMatch(/^acct-[0-9a-f]{16}$/);
  });
  test('sha256 matches WebCrypto', async () => {
    for (const text of ['', 'abc', 'https://a.example|u1', 'x'.repeat(200), 'é☃']) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(sha256Hex(text)).toBe(hex);
    }
  });
});

describe('account store', () => {
  test('set, get, clear', async () => {
    expect(await getAccount()).toBeNull();
    await setAccount(acct('u1'));
    expect((await getAccount())?.userId).toBe('u1');
    await clearAccount();
    expect(await getAccount()).toBeNull();
  });
});

describe('getActiveDb', () => {
  test('returns local without account', async () => {
    const db = await getActiveDb();
    expect(db.name).toBe('atelier-local');
    expect(currentUserId()).toBe('local');
  });
  test('opens the account partition and closes the old db on change', async () => {
    const local = await getActiveDb();
    const a = acct('u1');
    await setAccount(a);
    const db = await getActiveDb();
    expect(db.name).toBe(`atelier-${a.partition}`);
    expect(currentUserId()).toBe('u1');
    expect(local.isOpen()).toBe(false);
    expect(await getActiveDb()).toBe(db);
    await deleteDb(a.partition);
  });
});

describe('reminders', () => {
  test('new reminder uses signed-in user id', async () => {
    const a = acct('u1');
    await setAccount(a);
    const db = await getActiveDb();
    const ws = await createWorkspace(db, { name: 'W' });
    const cat = await createCategory(db, { workspaceId: ws.id, name: 'C' });
    const item = await createItem(db, { categoryId: cat.id, kind: 'note', title: 'n' } as never);
    const r = await setReminder(db, item.id, '2030-01-01T00:00:00.000Z');
    expect(r.userId).toBe('u1');
    expect(r.updatedBy).toBe('u1');
    await deleteDb(a.partition);
  });
});

describe('ActiveDbProvider', () => {
  test('switches partition when account changes', async () => {
    const seen: string[] = [];
    function Probe() {
      const db = useDb();
      seen.push(db.name);
      return <p>{db.name}</p>;
    }
    render(<ActiveDbProvider><Probe /></ActiveDbProvider>);
    expect(await screen.findByText('atelier-local')).toBeInTheDocument();
    const a = acct('u9');
    await act(async () => { await setAccount(a); });
    expect(await screen.findByText(`atelier-${a.partition}`)).toBeInTheDocument();
    await act(async () => { await clearAccount(); });
    await waitFor(() => expect(screen.getByText('atelier-local')).toBeInTheDocument());
    await deleteDb(a.partition);
  });
});
