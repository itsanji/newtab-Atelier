import { vi } from 'vitest';

type Listener = (...args: any[]) => void;

export interface FakeEvent<F extends Listener = Listener> {
  addListener(fn: F): void;
  removeListener(fn: F): void;
  hasListener(fn: F): boolean;
  /** Test helper: invoke every registered listener. */
  dispatch(...args: Parameters<F>): void;
}

export function createEvent<F extends Listener = Listener>(): FakeEvent<F> {
  const listeners = new Set<F>();
  return {
    addListener: (fn) => void listeners.add(fn),
    removeListener: (fn) => void listeners.delete(fn),
    hasListener: (fn) => listeners.has(fn),
    dispatch: (...args) => {
      for (const fn of [...listeners]) fn(...args);
    },
  };
}

export interface FakeTab {
  id: number;
  windowId: number;
  index: number;
  url?: string;
  title?: string;
  active: boolean;
  pinned: boolean;
  groupId: number;
  favIconUrl?: string;
}

export function createChromeFake() {
  let nextTabId = 1;
  let nextWindowId = 1;
  let nextGroupId = 1;
  const tabs = new Map<number, FakeTab>();
  const windows = new Map<number, { id: number; focused: boolean }>();
  const groups = new Map<number, { id: number; windowId: number; title?: string; color?: string; collapsed: boolean }>();
  const store: Record<string, unknown> = {};
  const alarmMap = new Map<string, { name: string; scheduledTime: number; periodInMinutes?: number }>();

  const addWindow = () => {
    const w = { id: nextWindowId++, focused: true };
    windows.set(w.id, w);
    return w;
  };

  const fake = {
    tabs: {
      onCreated: createEvent<(tab: FakeTab) => void>(),
      onRemoved: createEvent<(tabId: number, info: { windowId: number; isWindowClosing: boolean }) => void>(),
      onUpdated: createEvent<(tabId: number, change: Partial<FakeTab>, tab: FakeTab) => void>(),
      create: vi.fn(async (props: Partial<FakeTab> = {}) => {
        const windowId = props.windowId ?? [...windows.keys()][0] ?? addWindow().id;
        const tab: FakeTab = {
          id: nextTabId++,
          windowId,
          index: [...tabs.values()].filter((t) => t.windowId === windowId).length,
          active: props.active ?? true,
          pinned: props.pinned ?? false,
          groupId: -1,
          url: props.url,
          title: props.title,
        };
        tabs.set(tab.id, tab);
        fake.tabs.onCreated.dispatch(tab);
        return tab;
      }),
      remove: vi.fn(async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) return;
        tabs.delete(id);
        fake.tabs.onRemoved.dispatch(id, { windowId: tab.windowId, isWindowClosing: false });
      }),
      query: vi.fn(async (q: Partial<FakeTab> = {}) =>
        [...tabs.values()].filter((t) => Object.entries(q).every(([k, v]) => (t as any)[k] === v)),
      ),
      get: vi.fn(async (id: number) => tabs.get(id)),
      update: vi.fn(async (id: number, props: Partial<FakeTab>) => {
        const tab = tabs.get(id);
        if (!tab) return undefined;
        Object.assign(tab, props);
        fake.tabs.onUpdated.dispatch(id, props, tab);
        return tab;
      }),
    },
    tabGroups: {
      onCreated: createEvent<(g: unknown) => void>(),
      onRemoved: createEvent<(g: unknown) => void>(),
      onUpdated: createEvent<(g: unknown) => void>(),
      query: vi.fn(async () => [...groups.values()]),
      get: vi.fn(async (id: number) => groups.get(id)),
      update: vi.fn(async (id: number, props: object) => {
        const g = groups.get(id);
        if (g) Object.assign(g, props);
        return g;
      }),
    },
    windows: {
      onCreated: createEvent<(w: unknown) => void>(),
      onRemoved: createEvent<(id: number) => void>(),
      getAll: vi.fn(async () => [...windows.values()]),
      getCurrent: vi.fn(async () => [...windows.values()][0] ?? addWindow()),
      create: vi.fn(async () => addWindow()),
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          if (keys == null) return { ...store };
          const list = typeof keys === 'string' ? [keys] : keys;
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(store, items);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const k of typeof keys === 'string' ? [keys] : keys) delete store[k];
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(store)) delete store[k];
        }),
      },
      onChanged: createEvent<(changes: Record<string, unknown>, area: string) => void>(),
    },
    alarms: {
      onAlarm: createEvent<(alarm: { name: string }) => void>(),
      create: vi.fn(async (name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number } = {}) => {
        alarmMap.set(name, {
          name,
          scheduledTime: info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000,
          periodInMinutes: info.periodInMinutes,
        });
      }),
      clear: vi.fn(async (name: string) => alarmMap.delete(name)),
      getAll: vi.fn(async () => [...alarmMap.values()]),
    },
    notifications: {
      onClicked: createEvent<(id: string) => void>(),
      onButtonClicked: createEvent<(id: string, index: number) => void>(),
      create: vi.fn(async (id: string, _options: object) => id),
      clear: vi.fn(async (_id: string) => true),
    },
    contextMenus: {
      onClicked: createEvent<(info: object, tab?: FakeTab) => void>(),
      create: vi.fn((_props: object) => 'menu'),
      removeAll: vi.fn(async () => {}),
    },
    commands: {
      onCommand: createEvent<(command: string, tab?: FakeTab) => void>(),
    },
    runtime: {
      onMessage: createEvent<(message: unknown, sender: object, sendResponse: Listener) => void>(),
      onInstalled: createEvent<(details: object) => void>(),
      sendMessage: vi.fn(async (_message: unknown) => undefined),
      getURL: (path: string) => `chrome-extension://fake/${path.replace(/^\//, '')}`,
      id: 'fake-extension-id',
    },
  };
  return fake;
}

export type ChromeFake = ReturnType<typeof createChromeFake>;

export function installChromeFake(): ChromeFake {
  const fake = createChromeFake();
  (globalThis as any).chrome = fake;
  return fake;
}
