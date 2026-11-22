import { useEffect, useMemo, useRef } from 'react';

/**
 * `callback`, delayed until `delayMs` have passed without another call. Always calls
 * the latest `callback`, so a caller may pass a fresh closure on every render.
 */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): { call: (...args: Args) => void; cancel: () => void } {
  const latest = useRef(callback);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latest.current = callback;
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(
    () => ({
      call: (...args: Args) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => latest.current(...args), delayMs);
      },
      cancel: () => clearTimeout(timer.current),
    }),
    [delayMs],
  );
}
