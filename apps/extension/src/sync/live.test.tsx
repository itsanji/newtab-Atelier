import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { installChromeFake, type ChromeFake } from '../../test/chromeFake';
import type { Account } from '../account/account';
import { getSyncStatus } from './status';
import { useLiveSync } from './live';

class FakeSocket {
  static all: FakeSocket[] = [];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  say(m: object) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code = 1006) { this.onclose?.({ code }); }
}

const acct: Account = { serverUrl: 'http://s.example', userId: 'u1', email: 'a@x.io', displayName: 'A', token: 'tok', partition: 'acct-1' };
const syncNows = (fake: ChromeFake) => fake.runtime.sendMessage.mock.calls.filter((c) => (c[0] as any).type === 'sync-now').length;
let fake: ChromeFake;
beforeEach(() => {
  vi.useFakeTimers();
  fake = installChromeFake();
  FakeSocket.all = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useLiveSync', () => {
  test('does nothing without an account', () => {
    renderHook(() => useLiveSync(null));
    expect(FakeSocket.all).toHaveLength(0);
    expect(syncNows(fake)).toBe(0);
  });

  test('authenticates, syncs on mount and on changed, and closes on unmount', () => {
    const { unmount } = renderHook(() => useLiveSync(acct));
    expect(syncNows(fake)).toBe(1);
    const ws = FakeSocket.all[0]!;
    expect(ws.url).toBe('ws://s.example/api/live');
    ws.open();
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'auth', token: 'tok' });
    ws.say({ type: 'ready' });
    ws.say({ type: 'changed' });
    expect(syncNows(fake)).toBe(2);
    unmount();
    expect(ws.closed).toBe(true);
  });

  test('reconnects with backoff 1s, 2s, ... capped at 30s; ready resets it', () => {
    renderHook(() => useLiveSync(acct));
    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const before = FakeSocket.all.length;
      FakeSocket.all.at(-1)!.drop();
      // find the delay by stepping time
      let waited = 0;
      while (FakeSocket.all.length === before && waited < 40_000) { vi.advanceTimersByTime(500); waited += 500; }
      delays.push(waited);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
    FakeSocket.all.at(-1)!.say({ type: 'ready' });
    const n = FakeSocket.all.length;
    FakeSocket.all.at(-1)!.drop();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  test('close code 4401 marks sync paused and does not reconnect', async () => {
    renderHook(() => useLiveSync(acct));
    FakeSocket.all[0]!.drop(4401);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.waitFor(async () => expect(await getSyncStatus()).toMatchObject({ partition: 'acct-1', state: 'paused' }));
  });

  test('online event syncs and reconnects a dropped socket', () => {
    renderHook(() => useLiveSync(acct));
    FakeSocket.all[0]!.drop();
    window.dispatchEvent(new Event('online'));
    expect(FakeSocket.all).toHaveLength(2);
    expect(syncNows(fake)).toBe(2);
  });
});
