import { describe, expect, test } from 'bun:test';
import { ConfigError, loadConfig } from '../src/config';

const minimal = {
  PUBLIC_URL: 'https://atelier.example.com',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  test('accepts minimal config with smtp and google null', () => {
    const c = loadConfig(minimal);
    expect(c).toEqual({
      publicUrl: 'https://atelier.example.com',
      databaseUrl: minimal.DATABASE_URL,
      sessionSecret: minimal.SESSION_SECRET,
      port: 8787,
      trustProxy: false,
      allowSignup: true,
      smtp: null,
      google: null,
    });
  });

  test('rejects missing PUBLIC_URL', () => {
    const { PUBLIC_URL: _, ...env } = minimal;
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/PUBLIC_URL/);
  });

  test('rejects a PUBLIC_URL with a trailing slash or a bad scheme', () => {
    expect(() => loadConfig({ ...minimal, PUBLIC_URL: 'https://a.test/' })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...minimal, PUBLIC_URL: 'ftp://a.test' })).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig({ ...minimal, PUBLIC_URL: 'nonsense' })).toThrow(/PUBLIC_URL/);
  });

  test('rejects missing DATABASE_URL', () => {
    const { DATABASE_URL: _, ...env } = minimal;
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  test('rejects short SESSION_SECRET', () => {
    expect(() => loadConfig({ ...minimal, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  test('rejects an invalid PORT', () => {
    expect(() => loadConfig({ ...minimal, PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...minimal, PORT: '70000' })).toThrow(/PORT/);
    expect(loadConfig({ ...minimal, PORT: '9000' }).port).toBe(9000);
  });

  test('rejects SMTP_URL without SMTP_FROM, and the reverse', () => {
    expect(() => loadConfig({ ...minimal, SMTP_URL: 'smtp://localhost:25' })).toThrow(/SMTP_FROM/);
    expect(() => loadConfig({ ...minimal, SMTP_FROM: 'a@b.test' })).toThrow(/SMTP_URL/);
  });

  test('reads smtp when both are set', () => {
    const c = loadConfig({ ...minimal, SMTP_URL: 'smtp://localhost:25', SMTP_FROM: 'Atelier <a@b.test>' });
    expect(c.smtp).toEqual({ url: 'smtp://localhost:25', from: 'Atelier <a@b.test>' });
  });

  test('rejects half-configured google', () => {
    expect(() => loadConfig({ ...minimal, GOOGLE_CLIENT_ID: 'id' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => loadConfig({ ...minimal, GOOGLE_CLIENT_SECRET: 's' })).toThrow(/GOOGLE_CLIENT_ID/);
  });

  test('google uses default endpoints, overridable for tests', () => {
    const env = { ...minimal, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 's' };
    expect(loadConfig(env).google).toEqual({
      clientId: 'id',
      clientSecret: 's',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    });
    const over = loadConfig({
      ...env,
      GOOGLE_AUTH_URL: 'http://x/auth',
      GOOGLE_TOKEN_URL: 'http://x/token',
      GOOGLE_USERINFO_URL: 'http://x/info',
    });
    expect(over.google?.authUrl).toBe('http://x/auth');
    expect(over.google?.tokenUrl).toBe('http://x/token');
    expect(over.google?.userInfoUrl).toBe('http://x/info');
  });

  test('treats empty strings as unset', () => {
    const c = loadConfig({ ...minimal, SMTP_URL: '', SMTP_FROM: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', PORT: '' });
    expect(c.smtp).toBeNull();
    expect(c.google).toBeNull();
    expect(c.port).toBe(8787);
  });

  test('TRUST_PROXY defaults to false and accepts true or false only', () => {
    expect(loadConfig(minimal).trustProxy).toBe(false);
    expect(loadConfig({ ...minimal, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...minimal, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(() => loadConfig({ ...minimal, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
  });

  test('ALLOW_SIGNUP defaults to true and accepts true or false only', () => {
    expect(loadConfig(minimal).allowSignup).toBe(true);
    expect(loadConfig({ ...minimal, ALLOW_SIGNUP: 'false' }).allowSignup).toBe(false);
    expect(() => loadConfig({ ...minimal, ALLOW_SIGNUP: 'no' })).toThrow(/ALLOW_SIGNUP/);
  });
});
