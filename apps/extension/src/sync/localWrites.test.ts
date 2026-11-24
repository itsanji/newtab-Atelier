import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import { openDb } from '../data/db';
import { createWorkspace } from '../data/repo';
import { requestSyncOnLocalWrite } from './localWrites';

let fake: ChromeFake;
let stop: () => void = () => {};
beforeEach(() => {
  fake = installChromeFake();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

test('local writes send one debounced sync-now message', async () => {
  stop = requestSyncOnLocalWrite();
  const db = openDb('test-' + crypto.randomUUID());
  await createWorkspace(db, { name: 'a' });
  await createWorkspace(db, { name: 'b' });
  expect(fake.runtime.sendMessage).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  expect(fake.runtime.sendMessage).toHaveBeenCalledTimes(1);
  expect(fake.runtime.sendMessage).toHaveBeenCalledWith({ type: 'sync-now' });
});

test('a missing receiver is ignored', async () => {
  fake.runtime.sendMessage.mockRejectedValue(new Error('Receiving end does not exist.'));
  stop = requestSyncOnLocalWrite();
  await createWorkspace(openDb('test-' + crypto.randomUUID()), { name: 'a' });
  vi.advanceTimersByTime(1000);
  await Promise.resolve();
  expect(fake.runtime.sendMessage).toHaveBeenCalledTimes(1);
});
