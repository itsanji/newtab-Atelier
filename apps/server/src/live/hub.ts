/** Pushes "something changed" nudges to signed-in users' open pages. The WebSocket side arrives with the live task. */
export interface Hub {
  notifyUsers(userIds: string[]): void;
}

export function createHub(): Hub {
  return { notifyUsers() {} };
}
