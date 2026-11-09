/**
 * Light and dark mode follow the system preference (D55).
 *
 * The shadcn tokens switch on the `dark` class of `<html>`, so a toggle can be
 * added later without changing the CSS. Until then, the class mirrors
 * `prefers-color-scheme` and follows its changes.
 */

export const DARK_QUERY = '(prefers-color-scheme: dark)'

export function applyColorScheme(dark: boolean, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
}

/** Applies the current preference and follows it. Returns the cleanup. */
export function syncColorScheme(
  root: HTMLElement = document.documentElement,
  matchMedia: (query: string) => MediaQueryList = window.matchMedia.bind(window),
): () => void {
  const query = matchMedia(DARK_QUERY)
  const onChange = (event: MediaQueryListEvent) => applyColorScheme(event.matches, root)
  applyColorScheme(query.matches, root)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
