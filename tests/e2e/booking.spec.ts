import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { E2E_FILE, e2eKeys, GATEWAY, type E2eStudio } from './global-setup.ts'

const studio = JSON.parse(readFileSync(E2E_FILE, 'utf8')) as E2eStudio

test('a client books online and the owner sees the booking in the cabinet', async ({ page, browser }) => {
  const customer = `Е2Е Клиент ${Math.floor(Math.random() * 1e6)}`
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`

  // --- Client: studio page -> service -> vehicle -> slot -> confirm.
  await page.goto(`/s/${studio.slug}/`)
  await expect(page.getByRole('heading', { level: 1, name: studio.name })).toBeVisible()
  await page.getByRole('button', { name: 'Выбрать услугу и время' }).click()

  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button').filter({ hasText: studio.serviceName }).click()
  await sheet.getByLabel('Марка').fill('Toyota')
  await sheet.getByLabel('Модель').fill('Camry')
  await sheet.getByRole('radio', { name: /Седан/ }).click()
  await sheet.getByRole('button', { name: 'Продолжить' }).click()

  const times = sheet.locator('[role=radiogroup][aria-label="Время"] [role=radio]')
  await expect(times.first()).toBeVisible()
  await times.first().click()
  await sheet.getByRole('button', { name: 'Продолжить' }).click()

  await sheet.getByLabel('Имя').fill(customer)
  await sheet.getByLabel('Телефон').fill(phone)
  await sheet.locator('button[type=submit]').click()

  // --- Verify: the result screen, then the booking itself.
  await expect(page).toHaveURL(/book=done/)
  await expect(sheet.getByText('Вы записаны')).toBeVisible()
  const codeText = await sheet.getByText(/Номер записи/).innerText()
  const code = /([2-9A-Z]{6})/.exec(codeText)?.[1]
  expect(code).toBeTruthy()
  await sheet.getByRole('button', { name: 'Открыть запись' }).click()
  await expect(page).toHaveURL(new RegExp(`/s/${studio.slug}/history/[0-9a-f-]{36}$`))
  await expect(page.getByRole('heading', { name: `Запись ${code}` })).toBeVisible()
  await expect(page.getByText('Подтверждена').first()).toBeVisible()

  // --- Owner: a separate browser profile signs in and finds the same booking.
  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await owner.goto(`/s/${studio.slug}/owner/`)
  await owner.getByLabel('Email').fill(studio.ownerEmail)
  await owner.getByLabel('Пароль').fill(studio.ownerPassword)
  await owner.getByRole('button', { name: 'Войти' }).click()
  await expect(owner.getByRole('heading', { level: 1, name: 'Сегодня' })).toBeVisible()

  await owner.getByRole('link', { name: 'Клиенты' }).click()
  await owner.getByRole('searchbox', { name: 'Поиск клиентов' }).fill(customer)
  await owner.getByRole('link', { name: new RegExp(customer) }).click()
  await expect(owner.getByRole('heading', { name: customer })).toBeVisible()
  await owner.getByRole('button', { name: new RegExp(studio.serviceName) }).click()

  const ownerSheet = owner.getByRole('dialog')
  await expect(ownerSheet.getByText(`Запись ${code}`).first()).toBeVisible()
  await expect(ownerSheet.getByText('Подтверждена').first()).toBeVisible()
  await expect(ownerSheet.getByText('Toyota Camry')).toBeVisible()

  // The booking is also on its day in the resource-lane calendar.
  const keys = e2eKeys()
  const [row] = (await fetch(`${GATEWAY}/rest/v1/bookings?select=starts_at&tenant_id=eq.${studio.id}&code=eq.${code}`, {
    headers: { apikey: keys.serviceRoleKey, authorization: `Bearer ${keys.serviceRoleKey}` },
  }).then((r) => r.json())) as { starts_at: string }[]
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: studio.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(row!.starts_at))
  await owner.keyboard.press('Escape')
  await owner.goto(`/s/${studio.slug}/owner/calendar?date=${day}`)
  await expect(owner.getByRole('button', { name: new RegExp(`${customer}, ${studio.serviceName}`) })).toBeVisible()
  await ownerContext.close()
})
