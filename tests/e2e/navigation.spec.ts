import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { E2E_FILE, type E2eStudio } from './global-setup.ts'

const studio = JSON.parse(readFileSync(E2E_FILE, 'utf8')) as E2eStudio

/**
 * The screen a tab opens is really on screen: one screen in <main>, fully opaque, its heading
 * shown — and quickly. (An exit animation that never finished once left <main> transparent:
 * the content was in the DOM, so a plain visibility check would not have caught it.)
 */
async function expectScreen(page: Page, heading: RegExp | string, withinMs: number) {
  const screen = page.locator('main > div')
  await expect(screen).toHaveCount(1, { timeout: withinMs })
  await expect(screen).toHaveCSS('opacity', '1', { timeout: withinMs })
  await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible({ timeout: withinMs })
}

test('client tabs open their screens at once, every time', async ({ page }) => {
  await page.goto(`/s/${studio.slug}/`)
  await expectScreen(page, studio.name, 15_000)
  const nav = page.getByRole('navigation', { name: 'Разделы' }).last()
  const tabs: [string, string][] = [
    ['Запись', 'Услуги и запись'],
    ['Гараж', 'Мой гараж'],
    ['История', 'Мои записи'],
    ['Профиль', 'Профиль'],
    ['Главная', studio.name],
    ['История', 'Мои записи'],
    ['Гараж', 'Мой гараж'],
    ['Запись', 'Услуги и запись'],
  ]
  for (const [tab, heading] of tabs) {
    await nav.getByRole('link', { name: tab }).tap()
    await expectScreen(page, heading, 3_000)
  }
})

test('cabinet tabs open their screens at once', async ({ page }) => {
  await page.goto(`/s/${studio.slug}/owner/`)
  await page.getByLabel('Email').fill(studio.ownerEmail)
  await page.getByLabel('Пароль').fill(studio.ownerPassword)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()
  for (const [tab, heading] of [
    ['Календарь', /Календарь/],
    ['Клиенты', /Клиенты/],
    ['Услуги', /Услуги/],
    ['Студия', /Студия/],
    ['Сегодня', /Сегодня/],
  ] as const) {
    await page.getByRole('navigation').getByRole('link', { name: tab }).tap()
    await expect(page.getByRole('heading', { level: 1, name: heading }).first()).toBeVisible({ timeout: 3_000 })
    await expect(page.locator('main > div').first()).toHaveCSS('opacity', '1', { timeout: 3_000 })
  }
})
