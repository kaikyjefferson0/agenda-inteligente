import type { APIRequestContext } from '@playwright/test'

import { API, DEMO, expect, isApiCall, SITE, SLOT_NAME, test } from './support.ts'

/**
 * Items 4 and 5 of step 10: a booking on the demo's public page, through the
 * interface; the link of the success screen; the cancellation. One booking per
 * run at most (rate limit and the 100 e-mails a day of Resend), never retried,
 * and always cancelled at the end, even when a step in the middle fails.
 *
 * The customer's e-mail is a Resend test address by default, so nothing lands
 * in a real inbox. A label after "+" gives each run its own recipient, away
 * from the cap of 3 e-mails per recipient per day (EMAIL_RECIPIENT_DAILY_CAP).
 * SMOKE_CUSTOMER_EMAIL replaces it, for the SPF/DKIM/DMARC check by hand.
 */

const CUSTOMER_EMAIL =
  process.env.SMOKE_CUSTOMER_EMAIL ?? `delivered+smoke-${Date.now()}@resend.dev`

interface Booking {
  status: string
  starts_at: string
  access_url: string | null
  email_status: string
}

function tokenOf(accessUrl: string): string {
  const match = /\/agendamento\/([^/?#]+)/.exec(accessUrl)
  if (match === null) throw new Error(`link sem token: ${accessUrl}`)
  return match[1]
}

async function statusOf(request: APIRequestContext, token: string): Promise<string> {
  const response = await request.get(`${API}/api/v1/public/appointments/${token}`)
  expect(response.status(), 'GET do agendamento pelo link').toBe(200)
  return ((await response.json()) as { status: string }).status
}

/** Cleanup through the API: cancels the booking if the interface did not. */
async function ensureCancelled(request: APIRequestContext, token: string) {
  if ((await statusOf(request, token)) === 'cancelled') return
  const response = await request.post(`${API}/api/v1/public/appointments/${token}/cancel`)
  if (!response.ok()) {
    throw new Error(
      `LIXO: o agendamento ${SITE}/agendamento/${token} não foi cancelado ` +
        `(HTTP ${response.status()}: ${await response.text()}). Cancele pelo link.`,
    )
  }
  console.log('[smoke] limpeza: o agendamento foi cancelado pela API, depois de uma falha')
}

test('itens 4 e 5: agenda pela interface, abre o link, cancela', async ({ page, request }) => {
  let token: string | null = null
  // Any 201 of the booking, even one whose wait timed out, is cleaned up.
  page.on('response', async (response) => {
    if (
      isApiCall(`/api/v1/public/businesses/${DEMO.slug}/appointments`, 'POST')(response) &&
      response.status() === 201
    ) {
      const body = (await response.json().catch(() => null)) as Booking | null
      if (body?.access_url) token = tokenOf(body.access_url)
    }
  })

  try {
    await page.goto(`/n/${DEMO.slug}`)

    // Service and professional: the first ones the page offers.
    await page
      .getByRole('radiogroup', { name: 'Serviços' })
      .getByRole('radio', { disabled: false })
      .first()
      .click()
    await page.getByRole('button', { name: 'Continuar', exact: true }).click()
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

    // The first day after today with times: today is skipped, so the change
    // deadline (RN17, 2 hours in the demo) never closes the cancellation.
    const strip = page.getByRole('radiogroup', { name: 'Dia' })
    const days = strip.getByRole('radio')
    await expect(days.first()).toBeVisible()
    const labels = await days.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    )
    let found = false
    for (const label of labels) {
      if (label.startsWith('Hoje, ')) continue
      await strip.getByRole('radio', { name: label, exact: true }).click()
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible()
      const slots = page.getByRole('radio', { name: SLOT_NAME })
      await expect(slots.first().or(page.getByText('Sem horários livres neste dia'))).toBeVisible()
      if ((await slots.count()) > 0) {
        found = true
        break
      }
    }
    expect(found, 'nenhum dia com horários livres na faixa da página').toBe(true)

    const slot = page.getByRole('radio', { name: SLOT_NAME }).first()
    const time = (await slot.textContent())?.trim() ?? ''
    await slot.click()
    await page.getByRole('button', { name: `Continuar com ${time}` }).click()

    await page.getByLabel('Nome').fill('Teste de fumaça')
    await page.getByLabel('E-mail').fill(CUSTOMER_EMAIL)
    await page.getByLabel('Telefone').fill('11 98765-4321')
    const booked = page.waitForResponse(
      isApiCall(`/api/v1/public/businesses/${DEMO.slug}/appointments`, 'POST'),
    )
    // Clicked once: the only booking of the run.
    await page.getByRole('button', { name: 'Confirmar agendamento' }).click()
    const response = await booked
    expect(response.status(), `POST do agendamento: ${await response.text()}`).toBe(201)
    const booking = (await response.json()) as Booking
    expect(booking.status).toBe('confirmed')
    expect(booking.email_status, 'o e-mail de confirmação entrou na fila').toBe('queued')
    expect(booking.access_url).not.toBeNull()
    token = tokenOf(booking.access_url as string)

    // Item 4: the success screen, with the link.
    await expect(page.getByRole('heading', { name: 'Agendamento confirmado' })).toBeVisible()
    await expect(page.getByText(new RegExp(`^${time}–\\d{2}:\\d{2}$`))).toBeVisible()
    const link = await page.getByRole('textbox', { name: 'Link do seu agendamento' }).inputValue()
    expect(link, 'o link da tela é o da resposta da API').toBe(booking.access_url)
    expect(link.startsWith(`${SITE}/agendamento/`), `link no domínio do site: ${link}`).toBe(true)

    // Item 5: the link shown on screen, then the cancellation (D67).
    await page.goto(link)
    await expect(page.getByRole('heading', { level: 2, name: 'Seu agendamento' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancelar agendamento' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Cancelar este agendamento?' })
    await expect(dialog).toBeVisible()
    const cancelled = page.waitForResponse(
      isApiCall(`/api/v1/public/appointments/${token}/cancel`, 'POST'),
    )
    await dialog.getByRole('button', { name: 'Cancelar agendamento' }).click()
    const cancelResponse = await cancelled
    expect(cancelResponse.status(), 'POST do cancelamento').toBe(200)
    expect(
      ((await cancelResponse.json()) as { email_status: string }).email_status,
      'o e-mail de cancelamento entrou na fila',
    ).toBe('queued')
    await expect(page.getByRole('status').filter({ hasText: 'Agendamento cancelado' })).toBeVisible()
    await expect(page.getByText('Este agendamento foi cancelado, e o horário ficou livre.')).toBeVisible()

    // The state is cancelled in the API too, and after reopening the link.
    expect(await statusOf(request, token)).toBe('cancelled')
    await page.reload()
    await expect(page.getByText('Este agendamento foi cancelado, e o horário ficou livre.')).toBeVisible()
    console.log(`[smoke] agendado e cancelado às ${time}, e-mail para ${CUSTOMER_EMAIL}`)
  } finally {
    if (token !== null) await ensureCancelled(request, token)
  }
})
