import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Workspace } from '@atelier/core';
import type { Account } from '../account/account';
import { useDb } from '../data/DbContext';
import type { Member } from '../data/db';
import { ApiClient } from '../sync/api';
import { syncNow } from '../sync/localWrites';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Dialog';
import { Field } from '../ui/components/Field';
import { Tag } from '../ui/components/Tag';
import { useNotify } from './Notice';
import { useCurrentRole } from './useRole';

type Invitable = 'editor' | 'viewer';
const ROLES: Invitable[] = ['editor', 'viewer'];
const label = (m: Member) => m.displayName || m.email || 'Unknown';

/** Members of a workspace: the owner invites and manages roles; everyone else may leave. */
export function ShareDialog({ workspace, account, open, onClose }: { workspace: Workspace; account: Account; open: boolean; onClose(): void }) {
  const db = useDb();
  const notify = useNotify();
  const role = useCurrentRole();
  const api = useMemo(() => new ApiClient(account.serverUrl, account.token), [account.serverUrl, account.token]);
  const local = useLiveQuery(
    async () => (await db.members.where('workspaceId').equals(workspace.id).toArray()).filter((m) => !m.deletedAt),
    [db, workspace.id],
  );
  // The server's list is fresher than the last pull; it replaces the local one once fetched.
  const [fetched, setFetched] = useState<Member[] | null>(null);
  const members = fetched ?? local ?? [];
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Invitable>('editor');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setFetched((await api.members(workspace.id)).members.filter((m) => !m.deletedAt));
  }, [api, workspace.id]);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    refresh().catch(() => undefined); // offline: the synced copy stays on screen
  }, [open, refresh]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      syncNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    const to = email.trim();
    if (!to) return;
    void act(async () => {
      await api.invite(workspace.id, to, inviteRole);
      setEmail('');
      await refresh();
    });
  };

  const mine = members.find((m) => m.userId === account.userId);
  const leave = () => {
    if (!mine) return;
    void act(async () => {
      await api.removeMember(workspace.id, mine.id);
      notify(`You left ${workspace.name}`);
      onClose();
    });
  };

  return (
    <Dialog open={open} title={`Share ${workspace.name}`} onClose={onClose}>
      <ul className="atl-members" aria-label="Members">
        {members.map((m) => (
          <li key={m.id} className="atl-member">
            <span className="atl-member-name">
              {label(m)}
              {m.userId === null && <Tag tone="ochre">Pending</Tag>}
              {m.userId === account.userId && <Tag>You</Tag>}
            </span>
            {role === 'owner' && m.role !== 'owner' ? (
              <>
                <select
                  className="atl-select"
                  aria-label={`Role for ${label(m)}`}
                  value={m.role}
                  disabled={busy}
                  onChange={(e) => void act(async () => { await api.setRole(workspace.id, m.id, e.target.value as Invitable); await refresh(); })}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Remove ${label(m)}`}
                  onClick={() => void act(async () => { await api.removeMember(workspace.id, m.id); await refresh(); })}
                >
                  Remove
                </Button>
              </>
            ) : (
              <Tag tone={m.role === 'owner' ? 'lily' : 'neutral'}>{m.role}</Tag>
            )}
          </li>
        ))}
      </ul>
      {role === 'owner' && (
        <form className="atl-form" onSubmit={invite}>
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          <label className="im-field">
            <span className="im-field-label">Role</span>
            <select className="atl-select" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Invitable)}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="atl-form-actions">
            <Button variant="primary" type="submit" disabled={busy}>Send invite</Button>
          </div>
        </form>
      )}
      {error && <p className="atl-account-error" role="alert">{error}</p>}
      <div className="atl-form-actions">
        {role !== 'owner' && mine && <Button variant="danger" disabled={busy} onClick={leave}>Leave workspace</Button>}
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
