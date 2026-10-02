/**
 * Whether to skip animation: the person asked their phone for reduced motion. Where the browser can't say
 * (no `matchMedia`, as in unit tests) the answer is yes, so nothing waits for an animation that won't be seen.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
