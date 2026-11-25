import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Account } from '../account/account';
import { useAccount } from '../account/useAccount';
import { AccountSwitchError, finishSignIn, googleSignIn, GoogleSignInError, MagicLinkExpiredError, pollMagic, signOut } from '../account/signIn';
import { useDb } from '../data/DbContext';
import { ApiClient, ApiError, ensureHostPermission, InvalidServerUrl, normaliseServerUrl, OfflineError, type AuthResult, type ServerConfig } from '../sync/api';
import { Button } from '../ui/components/Button';
import { Dialog } from '../ui/components/Dialog';
import { Field } from '../ui/components/Field';
import { Icon } from '../ui/components/Icon';
import { downloadExport } from './DataMenu';
import { OPEN_ACCOUNT_EVENT, useSyncStatus } from './SyncStatus';

const UNREACHABLE = "Can't reach that server";
const FAILED = 'Something went wrong. Try again.';

function messageFor(e: unknown): string {
  if (e instanceof OfflineError) return UNREACHABLE;
  if (e instanceof AccountSwitchError || e instanceof GoogleSignInError || e instanceof MagicLinkExpiredError) return e.message;
  if (e instanceof ApiError) return e.message;
  console.error(e);
  return FAILED;
}

/** Sidebar entry: opens the account dialog (also on `OPEN_ACCOUNT_EVENT`, straight to signing in again). */
export function AccountEntry() {
  const account = useAccount();
  const [open, setOpen] = useState<null | 'normal' | 'reauth'>(null);
  useEffect(() => {
    const onOpen = () => setOpen('reauth');
    window.addEventListener(OPEN_ACCOUNT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ACCOUNT_EVENT, onOpen);
  }, []);
  if (account === undefined) return null;
  return (
    <>
      <button type="button" className="im-btn im-btn-ghost atl-account" onClick={() => setOpen('normal')}>
        <Icon name="user" size={18} />
        <span className="atl-account-label">{account ? account.displayName || account.email : 'Connect a server'}</span>
      </button>
      {/* Keyed, so the open-account event restarts an already open dialog in sign-in-again mode. */}
      {open && <AccountDialog key={open} reauth={open === 'reauth'} onClose={() => setOpen(null)} />}
    </>
  );
}

type Step =
  | { kind: 'account' }
  | { kind: 'unsynced' }
  | { kind: 'connect' }
  | { kind: 'signin'; api: ApiClient; config: ServerConfig; mode: 'signin' | 'signup' }
  | { kind: 'magic'; api: ApiClient; config: ServerConfig; email: string };

/** Connect, sign up / in (password, magic link, Google), or see and sign out of the current account. */
export function AccountDialog({ reauth = false, onClose }: { reauth?: boolean; onClose(): void }) {
  const account = useAccount();
  const db = useDb();
  const status = useSyncStatus(account?.partition);
  const [step, setStep] = useState<Step | null>(null);
  const [server, setServer] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const magic = useRef<AbortController | null>(null);
  // Kept while signing out, so the dialog stays put until sign-out has finished.
  const lastAccount = useRef<Account | null>(null);
  if (account) lastAccount.current = account;
  const alive = useRef(true);

  useEffect(() => () => {
    alive.current = false;
    magic.current?.abort();
  }, []);

  // First step, once the account is known: signing in again goes straight to the server's sign-in form.
  useEffect(() => {
    if (step || account === undefined) return;
    if (account && reauth) {
      setServer(account.serverUrl);
      setEmail(account.email);
      setStep({ kind: 'connect' });
      void connectTo(account.serverUrl);
    } else setStep(account ? { kind: 'account' } : { kind: 'connect' });
  }, [account, reauth, step]);

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(messageFor(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  async function connectTo(input: string) {
    let url: string;
    try {
      url = normaliseServerUrl(input);
    } catch (e) {
      if (!(e instanceof InvalidServerUrl)) throw e;
      setError('Enter a server address, like atelier.example.com');
      return;
    }
    await guard(async () => {
      // Asked first, while the click still counts as a user gesture.
      if (!(await ensureHostPermission(url))) {
        setError('Atelier needs your permission to reach that server.');
        return;
      }
      const api = new ApiClient(url);
      let config: ServerConfig;
      try {
        config = await api.config();
        if (!config?.auth) throw new Error('not an Atelier server');
      } catch {
        throw new OfflineError();
      }
      if (alive.current) setStep({ kind: 'signin', api, config, mode: 'signin' });
    });
  }

  const complete = async (api: ApiClient, result: AuthResult) => {
    await finishSignIn(api, result);
    if (alive.current) onClose();
  };

  const submitPassword = (api: ApiClient, mode: 'signin' | 'signup') => (e: FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      const result = mode === 'signup' ? await api.signUp(email.trim(), password, name.trim()) : await api.logIn(email.trim(), password);
      await complete(api, result);
    });
  };

  const emailLink = (api: ApiClient, config: ServerConfig) => {
    if (!email.trim()) {
      setError('Enter your email first');
      return;
    }
    void guard(async () => {
      const { requestId, pollSecret } = await api.magicStart(email.trim());
      const ctrl = new AbortController();
      magic.current = ctrl;
      setStep({ kind: 'magic', api, config, email: email.trim() });
      try {
        const result = await pollMagic(api, requestId, pollSecret, { signal: ctrl.signal });
        if (result) await complete(api, result);
      } catch (e) {
        if (!ctrl.signal.aborted && alive.current) setStep({ kind: 'signin', api, config, mode: 'signin' });
        throw e;
      }
    });
  };

  const google = (api: ApiClient) => void guard(async () => complete(api, await googleSignIn(api)));

  const doSignOut = (acct: Account, force: boolean) =>
    void guard(async () => {
      const result = await signOut(acct, undefined, { force });
      if (!alive.current) return;
      if (result === 'unsynced') setStep({ kind: 'unsynced' });
      else onClose();
    });

  if (!step) return null;

  if (step.kind === 'account' || step.kind === 'unsynced') {
    const shown = account ?? lastAccount.current;
    if (!shown) return null;
    const paused = status?.state === 'paused';
    return (
      <Dialog open title={step.kind === 'unsynced' ? 'Sign out' : 'Account'} onClose={onClose}>
        <dl className="atl-account-info">
          <dt>Server</dt>
          <dd>{shown.serverUrl}</dd>
          <dt>Email</dt>
          <dd>{shown.email}</dd>
        </dl>
        {step.kind === 'unsynced' ? (
          <>
            <p>Some changes haven't synced yet.</p>
            <p className="atl-account-note">Export your data to keep a copy. Signing out removes this account's board from this device.</p>
            <div className="atl-form-actions">
              <Button onClick={() => void guard(() => downloadExport(db))} disabled={busy}>Export data</Button>
              <Button variant="danger" onClick={() => doSignOut(shown, true)} disabled={busy}>Sign out anyway</Button>
              <Button variant="ghost" onClick={() => setStep({ kind: 'account' })} disabled={busy}>Cancel</Button>
            </div>
          </>
        ) : (
          <>
            {paused && <p>Your session ended. Sign in again to keep syncing.</p>}
            <div className="atl-form-actions">
              {paused && (
                <Button variant="primary" disabled={busy} onClick={() => { setEmail(shown.email); setServer(shown.serverUrl); void connectTo(shown.serverUrl); }}>
                  Sign in again
                </Button>
              )}
              <Button onClick={() => doSignOut(shown, false)} disabled={busy}>{busy ? 'Signing out…' : 'Sign out'}</Button>
              <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </>
        )}
        {error && <p className="atl-account-error" role="alert">{error}</p>}
      </Dialog>
    );
  }

  if (step.kind === 'magic') {
    return (
      <Dialog open title="Check your email" onClose={onClose}>
        <p>We sent a sign-in link to {step.email}. Open it on any device and this page signs you in.</p>
        <div className="atl-form-actions">
          <Button
            variant="ghost"
            onClick={() => {
              magic.current?.abort();
              setStep({ kind: 'signin', api: step.api, config: step.config, mode: 'signin' });
            }}
          >
            Cancel
          </Button>
        </div>
        {error && <p className="atl-account-error" role="alert">{error}</p>}
      </Dialog>
    );
  }

  if (step.kind === 'signin') {
    const { api, config, mode } = step;
    const signup = mode === 'signup';
    return (
      <Dialog open title={signup ? 'Create account' : 'Sign in'} onClose={onClose}>
        <p className="atl-account-note">{api.serverUrl}</p>
        <form className="atl-form" onSubmit={submitPassword(api, mode)}>
          {signup && <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'}
            required
          />
          {error && <p className="atl-account-error" role="alert">{error}</p>}
          <div className="atl-form-actions">
            <Button variant="primary" type="submit" disabled={busy}>{signup ? 'Create account' : 'Sign in'}</Button>
            {config.signup !== false && (
              <Button variant="ghost" disabled={busy} onClick={() => { setError(undefined); setStep({ ...step, mode: signup ? 'signin' : 'signup' }); }}>
                {signup ? 'I have an account' : 'Create account'}
              </Button>
            )}
          </div>
        </form>
        {(config.auth.magicLink || config.auth.google) && (
          <div className="atl-form-actions atl-account-alt">
            {config.auth.magicLink && <Button disabled={busy} onClick={() => emailLink(api, config)}>Email me a link</Button>}
            {config.auth.google && <Button disabled={busy} onClick={() => google(api)}>Continue with Google</Button>}
          </div>
        )}
        {!account && (
          <button type="button" className="atl-textlink atl-account-back" onClick={() => { setError(undefined); setStep({ kind: 'connect' }); }}>
            Use another server
          </button>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog open title="Connect a server" onClose={onClose}>
      <p className="atl-account-note">Sign in to your Atelier server to sync your board across devices and share workspaces.</p>
      <form className="atl-form" onSubmit={(e) => { e.preventDefault(); void connectTo(server); }}>
        <Field label="Server address" value={server} onChange={(e) => setServer(e.target.value)} placeholder="atelier.example.com" autoComplete="url" error={error} />
        <div className="atl-form-actions">
          <Button variant="primary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
