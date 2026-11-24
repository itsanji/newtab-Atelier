const fallbackTails = new Map<string, Promise<unknown>>();

/**
 * Run `fn` holding an exclusive lock named `name`: `navigator.locks` (shared by the worker and pages)
 * when available, else an in-process mutex (tests, old environments).
 */
export function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (locks) return locks.request(name, () => fn()) as Promise<T>;
  const prev = fallbackTails.get(name) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  fallbackTails.set(name, tail);
  void tail.then(() => {
    if (fallbackTails.get(name) === tail) fallbackTails.delete(name);
  });
  return run;
}
