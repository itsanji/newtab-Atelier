import type { Category, Item, Reminder, Workspace } from '@atelier/core';
import type { Member } from '../data/db';

export class InvalidServerUrl extends Error {
  constructor(input: string) {
    super(`Not a valid server address: ${input.trim() || '(empty)'}`);
    this.name = 'InvalidServerUrl';
  }
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export class UnauthorizedError extends ApiError {
  constructor(message = 'Sign in again') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}
export class OfflineError extends Error {
  constructor(message = 'Server unreachable') {
    super(message);
    this.name = 'OfflineError';
  }
}

/** Trim, default to https, drop trailing slashes and any path/query. */
export function normaliseServerUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new InvalidServerUrl(input);
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidServerUrl(input);
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) throw new InvalidServerUrl(input);
  return url.origin;
}

export type Role = 'owner' | 'editor' | 'viewer';
export type SyncTable = 'workspaces' | 'categories' | 'items' | 'reminders';
export interface Change {
  table: SyncTable;
  row: unknown;
}
export interface PushResult {
  table: SyncTable;
  id: string;
  status: 'applied' | 'restored' | 'rejected';
  reason?: string;
}
export interface ServerUser {
  id: string;
  email: string;
  displayName: string;
}
export interface ServerConfig {
  name: string;
  auth: { password: boolean; magicLink: boolean; google: boolean };
  /** False when the server takes no new sign-ups. Missing on older servers (treated as open). */
  signup?: boolean;
}
export interface AuthResult {
  token: string;
  user: ServerUser;
}
export interface PullResponse {
  cursor: number;
  workspaces: Workspace[];
  categories: Category[];
  items: Item[];
  reminders: Reminder[];
  members: Member[];
  removedWorkspaceIds: string[];
  /** Rows moved out of a workspace the caller can see into one they can't. Missing from older servers. */
  goneRows?: Array<{ table: 'categories' | 'items'; id: string }>;
}

const TIMEOUT_MS = 15_000;

export class ApiClient {
  readonly serverUrl: string;
  constructor(
    serverUrl: string,
    private token?: string,
  ) {
    this.serverUrl = normaliseServerUrl(serverUrl);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new OfflineError();
    }
    if (!res.ok) {
      let message = `Server error (${res.status})`;
      try {
        const data = (await res.json()) as { error?: unknown };
        if (typeof data.error === 'string') message = data.error;
      } catch {
        /* non-JSON error body */
      }
      if (res.status === 401) throw new UnauthorizedError(message);
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError(res.status, 'Unexpected response from server');
    }
  }

  config() {
    return this.request<ServerConfig>('GET', '/api/config');
  }
  signUp(email: string, password: string, displayName: string) {
    return this.request<AuthResult>('POST', '/api/auth/signup', { email, password, displayName });
  }
  logIn(email: string, password: string) {
    return this.request<AuthResult>('POST', '/api/auth/login', { email, password });
  }
  logOut() {
    return this.request<void>('POST', '/api/auth/logout');
  }
  me() {
    return this.request<{ user: ServerUser }>('GET', '/api/auth/me');
  }
  magicStart(email: string) {
    return this.request<{ requestId: string; pollSecret: string }>('POST', '/api/auth/magic/start', { email });
  }
  /** Resolves `{ status: 'pending' }` while waiting (server answers 202), otherwise the sign-in result. */
  magicPoll(requestId: string, pollSecret: string) {
    return this.request<AuthResult | { status: 'pending' }>('POST', '/api/auth/magic/poll', { requestId, pollSecret });
  }
  googleStartUrl(redirectUri: string, state: string): string {
    const q = new URLSearchParams({ redirect_uri: redirectUri, state });
    return `${this.serverUrl}/auth/google/start?${q}`;
  }
  googleExchange(code: string) {
    return this.request<AuthResult>('POST', '/api/auth/google/exchange', { code });
  }
  push(changes: Change[]) {
    return this.request<{ results: PushResult[] }>('POST', '/api/sync/push', { changes });
  }
  pull(cursor: number) {
    return this.request<PullResponse>('GET', `/api/sync/pull?cursor=${encodeURIComponent(String(cursor))}`);
  }
  members(workspaceId: string) {
    return this.request<{ members: Member[] }>('GET', `/api/workspaces/${enc(workspaceId)}/members`);
  }
  invite(workspaceId: string, email: string, role: Exclude<Role, 'owner'>) {
    return this.request<{ member: Member }>('POST', `/api/workspaces/${enc(workspaceId)}/members`, { email, role });
  }
  setRole(workspaceId: string, memberId: string, role: Exclude<Role, 'owner'>) {
    return this.request<{ member: Member }>('PATCH', `/api/workspaces/${enc(workspaceId)}/members/${enc(memberId)}`, { role });
  }
  removeMember(workspaceId: string, memberId: string) {
    return this.request<void>('DELETE', `/api/workspaces/${enc(workspaceId)}/members/${enc(memberId)}`);
  }
  share(categoryId: string) {
    return this.request<{ shareToken: string; url: string }>('POST', `/api/categories/${enc(categoryId)}/share`);
  }
  unshare(categoryId: string) {
    return this.request<void>('DELETE', `/api/categories/${enc(categoryId)}/share`);
  }
  liveUrl(): string {
    return `${this.serverUrl.replace(/^http/, 'ws')}/api/live`;
  }
}

const enc = encodeURIComponent;

/** True when the extension may call the server; asks the user (needs a click) otherwise. */
export async function ensureHostPermission(serverUrl: string): Promise<boolean> {
  const perm = { origins: [`${normaliseServerUrl(serverUrl)}/*`] };
  if (await chrome.permissions.contains(perm)) return true;
  return chrome.permissions.request(perm);
}
