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

/** A minimal in-memory `chrome.storage` area (used for `session`). */
function createArea(name: string, onChanged: FakeEvent) {
  const data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return { ...data };
      const list = typeof keys === 'string' ? [keys] : keys;
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue: unknown }> = {};
      for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: data[k], newValue: v };
      Object.assign(data, items);
      onChanged.dispatch(changes, name);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      const changes: Record<string, { oldValue?: unknown }> = {};
      for (const k of typeof keys === 'string' ? [keys] : keys) {
        if (k in data) changes[k] = { oldValue: data[k] };
        delete data[k];
      }
      onChanged.dispatch(changes, name);
    }),
  };
}

export function createChromeFake() {
  let nextTabId = 1;
  let nextWindowId = 1;
  let nextGroupId = 1;
  const tabs = new Map<number, FakeTab>();
  const windows = new Map<number, { id: number; focused: boolean }>();
  type FakeGroup = { id: number; windowId: number; title?: string; color?: string; collapsed: boolean };
  const groups = new Map<number, FakeGroup>();
  const inWindow = (windowId: number) => [...tabs.values()].filter((t) => t.windowId === windowId);
  const currentWindowId = () => [...windows.keys()][0] ?? addWindow().id;
  const store: Record<string, unknown> = {};
  const storageChanged = createEvent<(changes: Record<string, unknown>, area: string) => void>();
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
      onMoved: createEvent<(tabId: number, info: { windowId: number; fromIndex: number; toIndex: number }) => void>(),
      create: vi.fn(async (props: Partial<FakeTab> = {}) => {
        const windowId = props.windowId ?? currentWindowId();
        const siblings = inWindow(windowId);
        const tab: FakeTab = {
          id: nextTabId++,
          windowId,
          index: Math.min(props.index ?? siblings.length, siblings.length),
          active: props.active ?? true,
          pinned: props.pinned ?? false,
          groupId: -1,
          url: props.url,
          title: props.title,
        };
        for (const t of siblings) if (t.index >= tab.index) t.index++;
        if (tab.active) for (const t of siblings) t.active = false;
        tabs.set(tab.id, tab);
        fake.tabs.onCreated.dispatch(tab);
        return tab;
      }),
      remove: vi.fn(async (ids: number | number[]) => {
        for (const id of Array.isArray(ids) ? ids : [ids]) {
          const tab = tabs.get(id);
          if (!tab) continue;
          tabs.delete(id);
          for (const t of inWindow(tab.windowId)) if (t.index > tab.index) t.index--;
          fake.tabs.onRemoved.dispatch(id, { windowId: tab.windowId, isWindowClosing: false });
          if (groups.has(tab.groupId) && ![...tabs.values()].some((t) => t.groupId === tab.groupId)) {
            const g = groups.get(tab.groupId);
            groups.delete(tab.groupId);
            fake.tabGroups.onRemoved.dispatch(g);
          }
        }
      }),
      query: vi.fn(async (q: Record<string, unknown> = {}) => {
        const { currentWindow, ...rest } = q;
        return [...tabs.values()]
          .filter((t) => (currentWindow === undefined ? true : (t.windowId === currentWindowId()) === currentWindow))
          .filter((t) => Object.entries(rest).every(([k, v]) => (t as any)[k] === v))
          .sort((x, y) => x.windowId - y.windowId || x.index - y.index);
      }),
      get: vi.fn(async (id: number) => tabs.get(id)),
      update: vi.fn(async (id: number, props: Partial<FakeTab>) => {
        const tab = tabs.get(id);
        if (!tab) return undefined;
        Object.assign(tab, props);
        fake.tabs.onUpdated.dispatch(id, props, tab);
        return tab;
      }),
      move: vi.fn(async (id: number, props: { index: number; windowId?: number }) => {
        const tab = tabs.get(id);
        if (!tab) return undefined;
        const from = tab.index;
        const others = inWindow(tab.windowId).filter((t) => t.id !== id);
        const to = Math.max(0, Math.min(props.index < 0 ? others.length : props.index, others.length));
        others.splice(to, 0, tab);
        others.forEach((t, i) => (t.index = i));
        fake.tabs.onMoved.dispatch(id, { windowId: tab.windowId, fromIndex: from, toIndex: to });
        return tab;
      }),
      group: vi.fn(async (opts: { tabIds: number | number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        const ids = Array.isArray(opts.tabIds) ? opts.tabIds : [opts.tabIds];
        const first = tabs.get(ids[0]!);
        let gid = opts.groupId;
        if (gid === undefined) {
          gid = nextGroupId++;
          const g = { id: gid, windowId: opts.createProperties?.windowId ?? first?.windowId ?? currentWindowId(), collapsed: false } as FakeGroup;
          groups.set(gid, g);
          fake.tabGroups.onCreated.dispatch(g);
        }
        for (const id of ids) {
          const t = tabs.get(id);
          if (!t) continue;
          t.groupId = gid;
          fake.tabs.onUpdated.dispatch(id, { groupId: gid }, t);
        }
        return gid;
      }),
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      onCreated: createEvent<(g: unknown) => void>(),
      onRemoved: createEvent<(g: unknown) => void>(),
      onUpdated: createEvent<(g: unknown) => void>(),
      query: vi.fn(async (q: Record<string, unknown> = {}) =>
        [...groups.values()].filter((g) => Object.entries(q).every(([k, v]) => (g as any)[k] === v)),
      ),
      get: vi.fn(async (id: number) => groups.get(id)),
      update: vi.fn(async (id: number, props: object) => {
        const g = groups.get(id);
        if (g) {
          Object.assign(g, props);
          fake.tabGroups.onUpdated.dispatch(g);
        }
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
          const changes: Record<string, { oldValue?: unknown; newValue: unknown }> = {};
          for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: store[k], newValue: v };
          Object.assign(store, items);
          fake.storage.onChanged.dispatch(changes, 'local');
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const changes: Record<string, { oldValue?: unknown }> = {};
          for (const k of typeof keys === 'string' ? [keys] : keys) {
            if (k in store) changes[k] = { oldValue: store[k] };
            delete store[k];
          }
          fake.storage.onChanged.dispatch(changes, 'local');
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(store)) delete store[k];
        }),
      },
      session: createArea('session', storageChanged),
      onChanged: storageChanged,
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
    permissions: {
      contains: vi.fn(async (_perm: { origins?: string[] }) => true),
      request: vi.fn(async (_perm: { origins?: string[] }) => true),
    },
    identity: {
      getRedirectURL: (path = '') => `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/${path}`,
      launchWebAuthFlow: vi.fn(async (_details: { url: string; interactive?: boolean }): Promise<string | undefined> => undefined),
    },
    runtime: {
      onMessage: createEvent<(message: unknown, sender: object, sendResponse: Listener) => void>(),
      onInstalled: createEvent<(details: object) => void>(),
      onStartup: createEvent<() => void>(),
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
