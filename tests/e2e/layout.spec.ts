import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { E2E_FILE, type E2eStudio } from './global-setup.ts'

const studio = JSON.parse(readFileSync(E2E_FILE, 'utf8')) as E2eStudio

/** Phone, landscape phone, tablet (touch) and desktop (mouse). */
const SIZES = [
  { width: 320, height: 640, touch: true },
  { width: 844, height: 390, touch: true },
  { width: 1024, height: 768, touch: true },
  { width: 1440, height: 900, touch: false },
]

/**
 * Nothing sticks out sideways (no horizontal scroll), and on touch screens everything that can
 * be tapped is at least 44×44 px — counting a ::after hit area around a small control.
 */
async function layoutProblems(page: Page, touch: boolean): Promise<string[]> {
  await page.waitForTimeout(400)
  return page.evaluate((touch) => {
    const problems: string[] = []
    const vw = window.innerWidth
    if (document.documentElement.scrollWidth > vw + 1) problems.push(`horizontal scroll: ${document.documentElement.scrollWidth}px in ${vw}px`)
    if (!touch) return problems
    for (const el of document.querySelectorAll<HTMLElement>('a[href], button, [role=button], [role=radio], [role=tab], [role=switch], [role=checkbox], input:not([type=hidden]), select, textarea')) {
      const r = el.getBoundingClientRect()
      if (r.width <= 1 || r.height <= 1) continue // visually hidden (a file input behind its button)
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.pointerEvents === 'none') continue
      if (el.tagName === 'A' && st.display === 'inline' && el.closest('p')) continue // a link in running text
      const after = getComputedStyle(el, '::after')
      const extra = after.position === 'absolute' ? { w: parseFloat(after.width) || 0, h: parseFloat(after.height) || 0 } : { w: 0, h: 0 }
      // Half a pixel of sub-pixel layout is not a smaller target.
      if (Math.max(r.width, extra.w) < 43.5 || Math.max(r.height, extra.h) < 43.5) {
        const name = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40)
        problems.push(`small target ${Math.round(r.width)}x${Math.round(r.height)}: ${el.tagName.toLowerCase()} «${name}»`)
      }
    }
    return problems
  }, touch)
}

for (const size of SIZES) {
  test(`client and cabinet fit ${size.width}×${size.height}${size.touch ? ', touch' : ''}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.touch && size.width < 900, locale: 'ru-RU' })
    const page = await ctx.newPage()
    const problems: string[] = []
    for (const path of ['', 'services', 'garage', 'history', 'profile']) {
      await page.goto(`/s/${studio.slug}/${path}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      problems.push(...(await layoutProblems(page, size.touch)).map((p) => `/${path}: ${p}`))
    }
    await page.goto(`/s/${studio.slug}/`)
    await page.getByRole('button', { name: 'Выбрать услугу и время' }).first().click()
    await page.getByRole('dialog').first().waitFor()
    problems.push(...(await layoutProblems(page, size.touch)).map((p) => `booking: ${p}`))

    await page.goto(`/s/${studio.slug}/owner/`)
    await page.getByLabel('Email').fill(studio.ownerEmail)
    await page.getByLabel('Пароль').fill(studio.ownerPassword)
    await page.getByRole('button', { name: 'Войти' }).click()
    await page.getByRole('heading', { level: 1, name: 'Сегодня' }).waitFor()
    for (const path of ['', 'calendar', 'customers', 'services', 'schedule', 'settings']) {
      await page.goto(`/s/${studio.slug}/owner/${path}`)
      await page.getByRole('heading', { level: 1 }).first().waitFor()
      problems.push(...(await layoutProblems(page, size.touch)).map((p) => `owner/${path}: ${p}`))
    }
    await ctx.close()
    expect(problems).toEqual([])
  })
}
