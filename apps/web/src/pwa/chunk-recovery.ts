/**
 * After a deploy, a page opened earlier can ask for a script of its own build that the server
 * no longer has (the server keeps one previous build; a browser tab can be older). The request
 * gets a real 404 — never the HTML page — and the screen the visitor opened fails to load.
 * RouteError then loads the new build with one reload: only for a screen the visitor is
 * waiting for (a failed background prefetch never reloads the page under their fingers), only
 * online, and at most once a minute — if it did not help, the error screen stays.
 */
const KEY = 'dp:stale-build-reload'

export function isStaleBuildError(error: unknown): boolean {
  return error instanceof Error && /dynamically imported module|Failed to fetch|Importing a module script failed|error loading dynamically/i.test(error.message)
}

/** Reloads the page for the new build, unless offline or just tried. Returns whether it reloads. */
export function reloadForNewBuild(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY) ?? 0)
  } catch {
    /* storage unavailable: still try once */
  }
  if (Date.now() - last < 60_000) return false
  try {
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
  window.location.reload()
  return true
}
