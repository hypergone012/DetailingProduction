import { useEffect, useRef } from 'react'

const IN_DIALOG = 'dialog, [role="dialog"], [role="alertdialog"]'

/** The control the person last used outside any sheet or dialog (focus or tap). */
let lastOutside: HTMLElement | null = null

if (typeof document !== 'undefined') {
  const remember = (el: Element | null | undefined) => {
    if (el instanceof HTMLElement && el !== document.body && !el.closest(IN_DIALOG)) lastOutside = el
  }
  document.addEventListener('focusin', (e) => remember(e.target as Element | null), true)
  // Safari does not focus buttons on click; the tapped control is still where focus belongs.
  document.addEventListener('pointerdown', (e) => remember((e.target as Element | null)?.closest?.('button, a[href], [tabindex]')), true)
}

/**
 * Returns focus to the control that opened a sheet once the sheet closes. URL-driven sheets
 * close by navigation and unmount their <dialog>, so the browser cannot do it by itself and
 * keyboard and screen-reader users would land on <body>.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    opener.current = lastOutside
    return () => {
      const target = opener.current
      requestAnimationFrame(() => {
        const now = document.activeElement
        if (target?.isConnected && (!now || now === document.body)) target.focus({ preventScroll: true })
      })
    }
  }, [open])
}
