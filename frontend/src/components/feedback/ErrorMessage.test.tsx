import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError } from '@/api/errors'
import { ERROR_MESSAGES, GENERIC_ERROR_MESSAGE, NETWORK_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from '@/api/messages'

import { ErrorMessage } from './ErrorMessage'

describe('ErrorMessage (D53)', () => {
  it.each([
    ['SLOT_UNAVAILABLE', 409, 'Este horário não está mais disponível. Escolha outro.'],
    ['CHANGE_DEADLINE_PASSED', 409, 'O prazo para alterar este agendamento já passou. Fale com o negócio.'],
    ['INVALID_CREDENTIALS', 401, 'E-mail ou senha incorretos.'],
    ['DEMO_RESTRICTED', 403, 'Esta ação não está disponível no negócio de demonstração.'],
  ])('shows the Portuguese message of %s', (code, status, message) => {
    render(<ErrorMessage error={new ApiError({ status, code, detail: 'detail in the API' })} />)

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByText('detail in the API')).not.toBeInTheDocument()
  })

  it('has a message for every code of the API', () => {
    expect(Object.keys(ERROR_MESSAGES)).toHaveLength(23)
  })

  it('shows the generic message for an unknown code', () => {
    render(<ErrorMessage error={new ApiError({ status: 418, code: 'SOMETHING_NEW' })} />)
    expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_ERROR_MESSAGE)
  })

  it('shows the generic message for an error that is not from the API', () => {
    render(<ErrorMessage error={new Error('boom')} />)
    expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_ERROR_MESSAGE)
  })

  it('shows the network message for NetworkError', () => {
    render(<ErrorMessage error={new NetworkError()} />)
    expect(screen.getByRole('alert')).toHaveTextContent(NETWORK_ERROR_MESSAGE)
  })

  it('shows the server message for a 5xx without code', () => {
    render(<ErrorMessage error={new ApiError({ status: 502 })} />)
    expect(screen.getByRole('alert')).toHaveTextContent(SERVER_ERROR_MESSAGE)
  })

  it.each([
    [1, 'Tente de novo em 1 segundo.'],
    [30, 'Tente de novo em 30 segundos.'],
    [60, 'Tente de novo em 1 minuto.'],
    [600, 'Tente de novo em 10 minutos.'],
  ])('tells how long to wait after a 429 with Retry-After %i', (seconds, hint) => {
    render(
      <ErrorMessage
        error={new ApiError({ status: 429, code: 'RATE_LIMITED', retryAfterSeconds: seconds })}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(`${ERROR_MESSAGES.RATE_LIMITED} ${hint}`)
  })

  it('shows the title and calls onRetry', async () => {
    const onRetry = vi.fn()
    render(<ErrorMessage error={new NetworkError()} title="Falha ao carregar" onRetry={onRetry} />)

    expect(screen.getByText('Falha ao carregar')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
