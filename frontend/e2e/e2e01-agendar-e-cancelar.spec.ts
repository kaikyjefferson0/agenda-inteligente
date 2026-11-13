import { expect, test, type Page } from '@playwright/test'

import { DEMO, SLOT_NAME, waitForSlots } from './support.ts'

/**
 * E2E01 (UC10 to UC13): the customer books on the demo's public page, opens the
 * appointment's link from the success screen and cancels it; the same time
 * then shows as free again. Everything is chosen from what the page shows
 * (D103), and the browser runs in Asia/Tokyo while the business is in São Paulo.
 */

/** Opens the picker on `url` and waits for the day to load. */
async function openDay(page: Page, url: string, day: string) {
  await page.goto(url)
  await expect(page.getByRole('heading', { name: day, exact: true })).toBeVisible()
  return waitForSlots(page)
}

test('E2E01: agenda, abre o link, cancela e o horário volta a ficar livre', async ({
  page,
}, testInfo) => {
  await page.goto(`/n/${DEMO.slug}`)

  // Service and professional: the first ones the page offers. A specific
  // professional, because with "Qualquer profissional" the time could stay on
  // the list through the other one, and the test would prove nothing.
  await page
    .getByRole('radiogroup', { name: 'Serviços' })
    .getByRole('radio', { disabled: false })
    .first()
    .click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  // A service done by a single professional skips the professional step: that
  // one is already specific.
  const professionalStep = page.getByRole('heading', { name: 'Escolha o profissional' })
  const dateStep = page.getByRole('heading', { name: 'Escolha o dia e o horário' })
  await expect(professionalStep.or(dateStep)).toBeVisible()
  if (await professionalStep.isVisible()) {
    await page
      .getByRole('radiogroup', { name: 'Profissionais' })
      .getByRole('radio', { name: /^(?!Qualquer profissional$)/ })
      .first()
      .click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  }
  await expect(dateStep).toBeVisible()

  // The first day after today with times. Today is skipped so the change
  // deadline (RN17, 2 hours in the demo) never closes the cancellation.
  const strip = page.getByRole('radiogroup', { name: 'Dia' })
  const days = strip.getByRole('radio')
  await expect(days.first()).toBeVisible()
  const labels = await days.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )
  let day: string | null = null
  for (const label of labels) {
    if (label.startsWith('Hoje, ')) continue
    await strip.getByRole('radio', { name: label, exact: true }).click()
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
    const slots = await waitForSlots(page)
    if ((await slots.count()) > 0) {
      day = label
      break
    }
  }
  expect(day, 'nenhum dia com horários livres na faixa da página').not.toBeNull()
  const chosenDay = day as string

  // D65: service, professional and day are in the URL; it reopens this day.
  const dayUrl = page.url()
  const slot = page.getByRole('radio', { name: SLOT_NAME }).first()
  const time = (await slot.textContent())?.trim() ?? ''
  expect(time).toMatch(SLOT_NAME)
  await slot.click()
  await page.getByRole('button', { name: `Continuar com ${time}` }).click()

  await page.getByLabel('Nome').fill('Cliente E2E')
  await page.getByLabel('E-mail').fill(`cliente-${testInfo.project.name}@example.com`)
  await page.getByLabel('Telefone').fill('11 98765-4321')
  const booked = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/api/v1/public/businesses/${DEMO.slug}/appointments`),
  )
  await page.getByRole('button', { name: 'Confirmar agendamento' }).click()
  const response = await booked
  expect(response.status()).toBe(201)
  const booking = (await response.json()) as { starts_at: string }

  // D103: the API answers with the business's offset (-03:00, never Tokyo's
  // +09:00), and the clock time in it is the one clicked and the one shown.
  expect(booking.starts_at).toMatch(/-03:00$/)
  expect(booking.starts_at.slice(11, 16)).toBe(time)
  await expect(page.getByRole('heading', { name: 'Agendamento confirmado' })).toBeVisible()
  await expect(page.getByText(new RegExp(`^${time}–\\d{2}:\\d{2}$`))).toBeVisible()

  // With the time taken, the professional no longer offers it.
  const link = await page.getByRole('textbox', { name: 'Link do seu agendamento' }).inputValue()
  expect(link).toMatch(/^http:\/\/localhost:5175\/agendamento\//)
  const whileBooked = await openDay(page, dayUrl, chosenDay)
  await expect(whileBooked.filter({ hasText: time })).toHaveCount(0)

  // The link of the success screen, then the cancellation (D67).
  await page.goto(link)
  await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Cancelar este agendamento?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancelar agendamento' }).click()
  // D101: the result is announced in a status region.
  await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado' })).toBeVisible()
  await expect(page.getByText('Este agendamento foi cancelado, e o horário ficou livre.')).toBeVisible()

  // The same time, on the same day and with the same professional, is free again.
  const afterCancel = await openDay(page, dayUrl, chosenDay)
  await expect(afterCancel.filter({ hasText: time })).toHaveCount(1)
})
