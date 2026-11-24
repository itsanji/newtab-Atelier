export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
}

export interface Config {
  publicUrl: string;
  databaseUrl: string;
  sessionSecret: string;
  port: number;
  smtp: { url: string; from: string } | null;
  google: GoogleConfig | null;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

const GOOGLE_DEFAULTS = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
};

/** Reads and validates the environment. Empty strings count as unset (compose passes them through). */
export function loadConfig(env: Env): Config {
  const get = (name: string): string | undefined => env[name]?.trim() || undefined;
  const required = (name: string): string => {
    const value = get(name);
    if (!value) throw new ConfigError(`${name} is required`);
    return value;
  };

  const publicUrl = required('PUBLIC_URL');
  let parsed: URL | null = null;
  try {
    parsed = new URL(publicUrl);
  } catch {
    // reported below
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || publicUrl.endsWith('/')) {
    throw new ConfigError('PUBLIC_URL must be an http or https URL with no trailing slash');
  }

  const databaseUrl = required('DATABASE_URL');
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new ConfigError('SESSION_SECRET must be at least 32 characters');

  const rawPort = get('PORT');
  const port = rawPort === undefined ? 8787 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError('PORT must be a number from 1 to 65535');

  const smtpUrl = get('SMTP_URL');
  const smtpFrom = get('SMTP_FROM');
  if (smtpUrl && !smtpFrom) throw new ConfigError('SMTP_FROM is required when SMTP_URL is set');
  if (smtpFrom && !smtpUrl) throw new ConfigError('SMTP_URL is required when SMTP_FROM is set');

  const clientId = get('GOOGLE_CLIENT_ID');
  const clientSecret = get('GOOGLE_CLIENT_SECRET');
  if (clientId && !clientSecret) throw new ConfigError('GOOGLE_CLIENT_SECRET is required when GOOGLE_CLIENT_ID is set');
  if (clientSecret && !clientId) throw new ConfigError('GOOGLE_CLIENT_ID is required when GOOGLE_CLIENT_SECRET is set');

  return {
    publicUrl,
    databaseUrl,
    sessionSecret,
    port,
    smtp: smtpUrl && smtpFrom ? { url: smtpUrl, from: smtpFrom } : null,
    google:
      clientId && clientSecret
        ? {
            clientId,
            clientSecret,
            authUrl: get('GOOGLE_AUTH_URL') ?? GOOGLE_DEFAULTS.authUrl,
            tokenUrl: get('GOOGLE_TOKEN_URL') ?? GOOGLE_DEFAULTS.tokenUrl,
            userInfoUrl: get('GOOGLE_USERINFO_URL') ?? GOOGLE_DEFAULTS.userInfoUrl,
          }
        : null,
  };
}
