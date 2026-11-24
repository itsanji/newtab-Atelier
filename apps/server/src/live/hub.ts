import type { WSContext } from 'hono/ws';

/** Pushes "something changed" nudges to signed-in users' open pages. */
export interface Hub {
  notifyUsers(userIds: string[]): void;
  /** Subscribes a socket to a user's nudges; returns the unsubscribe function. */
  subscribe(userId: string, socket: Pick<WSContext, 'send'>): () => void;
}

export function createHub(): Hub {
  const sockets = new Map<string, Set<Pick<WSContext, 'send'>>>();
  return {
    notifyUsers(userIds) {
      const message = JSON.stringify({ type: 'changed' });
      for (const id of new Set(userIds)) {
        for (const socket of sockets.get(id) ?? []) {
          try {
            socket.send(message);
          } catch {
            // A socket that cannot be written to is closing; its close handler unsubscribes it.
          }
        }
      }
    },
    subscribe(userId, socket) {
      let set = sockets.get(userId);
      if (!set) sockets.set(userId, (set = new Set()));
      set.add(socket);
      return () => {
        set.delete(socket);
        if (set.size === 0 && sockets.get(userId) === set) sockets.delete(userId);
      };
    },
  };
}
