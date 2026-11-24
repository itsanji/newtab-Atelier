const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

/** In-memory failed-attempt counter keyed by `ip|email`. */
export class RateLimiter {
  private failures = new Map<string, number[]>();

  constructor(private now: () => Date) {}

  private recent(key: string): number[] {
    const cutoff = this.now().getTime() - WINDOW_MS;
    const kept = (this.failures.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  isBlocked(key: string): boolean {
    return this.recent(key).length >= MAX_FAILURES;
  }

  recordFailure(key: string): void {
    const kept = this.recent(key);
    kept.push(this.now().getTime());
    this.failures.set(key, kept);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

/** First `x-forwarded-for` entry, else the socket address. */
export function clientIp(headers: Headers, socketAddress: string | undefined): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || socketAddress || 'unknown';
}
