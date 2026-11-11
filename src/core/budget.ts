// Forge stops a function after 25 seconds. These helpers let optional work
// run against a deadline and be left out, instead of failing the whole answer.

export type Settled<T> = { state: 'ok'; value: T } | { state: 'error'; error: unknown } | { state: 'timeout' };

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Starts `work` and waits for it until `deadline` (epoch milliseconds). Never
 * rejects: the caller decides what a failure or a late answer means. Late work
 * is no longer waited for, but it is not cancelled. Once the deadline has
 * passed, the work is not started at all.
 */
export async function settleBy<T>(deadline: number, work: () => Promise<T>): Promise<Settled<T>> {
  const left = deadline - Date.now();
  if (left <= 0) return { state: 'timeout' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Settled<T>>((resolve) => {
    timer = setTimeout(() => resolve({ state: 'timeout' }), left);
  });
  try {
    const settled = Promise.resolve()
      .then(work)
      .then(
        (value): Settled<T> => ({ state: 'ok', value }),
        (error: unknown): Settled<T> => ({ state: 'error', error }),
      );
    return await Promise.race([settled, late]);
  } finally {
    clearTimeout(timer);
  }
}
