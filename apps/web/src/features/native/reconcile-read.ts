/** Reconcile a read after the HTTP client's own short retry window is exhausted.
 * Never accepts command callbacks. Aborting a room also cancels its backoff. */
export async function reconcileRead<T>(read: () => Promise<T>, signal: AbortSignal, attempts = 3, delayMs = 1000): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { const value = await read(); signal.throwIfAborted(); return value }
    catch (error) {
      signal.throwIfAborted()
      if (attempt + 1 >= attempts) throw error
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException("Read cancelled", "AbortError")) }
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve() }, delayMs * (attempt + 1))
        signal.addEventListener("abort", abort, { once: true })
      })
    }
  }
}

export function assertFreshSnapshot(fresh: { currentRevisionId: string | null; headVersion: number }, observedHead: string | null, displayed: { headVersion: number } | null): void {
  if (fresh.currentRevisionId !== observedHead || fresh.headVersion < (displayed?.headVersion ?? 0)) throw new Error("Saved arrangement is still catching up")
}
