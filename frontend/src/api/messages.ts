import { ApiError, NetworkError, type ApiErrorCode } from './errors'

/** Portuguese text for each stable `code` of the API (D53). */
export const ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_TOKEN: 'Este link é inválido, expirou ou já foi usado.',
  INVALID_CREDENTIALS: 'E-mail ou senha incorretos.',
  NOT_AUTHENTICATED: 'Sua sessão terminou. Entre novamente.',
  INVALID_REFRESH_TOKEN: 'Sua sessão expirou. Entre novamente.',
  FORBIDDEN: 'Você não tem permissão para fazer isso.',
  REGISTRATION_DISABLED: 'O cadastro de novos negócios está desligado.',
  DEMO_RESTRICTED: 'Esta ação não está disponível no negócio de demonstração.',
  NOT_FOUND: 'Não encontramos o que você procurou.',
  SLOT_UNAVAILABLE: 'Este horário não está mais disponível. Escolha outro.',
  CHANGE_DEADLINE_PASSED: 'O prazo para alterar este agendamento já passou. Fale com o negócio.',
  INVALID_STATUS_TRANSITION: 'A situação atual do agendamento não permite esta alteração.',
  IDEMPOTENCY_KEY_REUSED:
    'Esta solicitação já foi enviada com outros dados. Recarregue a página e tente de novo.',
  APPOINTMENT_CONFLICTS: 'Há agendamentos em conflito. Resolva-os antes de continuar.',
  TIME_BLOCK_OVERLAP: 'Já existe um bloqueio nesse período.',
  INVITATION_NOT_PENDING: 'Este convite não está mais pendente: a pessoa já aceitou ou a conta foi desativada.',
  EMAIL_IN_USE: 'Este e-mail já está em uso.',
  SLUG_IN_USE: 'Este endereço já está em uso.',
  VALIDATION_ERROR: 'Confira os dados informados.',
  RATE_LIMITED: 'Muitas tentativas seguidas. Aguarde um pouco e tente de novo.',
  DATABASE_UNAVAILABLE: 'O serviço está temporariamente indisponível. Tente de novo em instantes.',
  HTTP_ERROR: 'Não foi possível concluir a solicitação.',
  INTERNAL_ERROR: 'Ocorreu um erro inesperado. Tente de novo em instantes.',
}

export const NETWORK_ERROR_MESSAGE =
  'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.'
export const SERVER_ERROR_MESSAGE =
  'O serviço está temporariamente indisponível. Tente de novo em instantes.'
export const GENERIC_ERROR_MESSAGE = 'Algo deu errado. Tente de novo.'

function isKnownCode(code: string | null): code is ApiErrorCode {
  return code !== null && Object.hasOwn(ERROR_MESSAGES, code)
}

function waitHint(seconds: number): string {
  if (seconds < 60) return `Tente de novo em ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}.`
  const minutes = Math.ceil(seconds / 60)
  return `Tente de novo em ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
}

/** The message shown to the user for any error thrown by the client. */
export function errorMessage(error: unknown): string {
  if (error instanceof NetworkError) return NETWORK_ERROR_MESSAGE
  if (!(error instanceof ApiError)) return GENERIC_ERROR_MESSAGE
  if (error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== null) {
    return `${ERROR_MESSAGES.RATE_LIMITED} ${waitHint(error.retryAfterSeconds)}`
  }
  if (isKnownCode(error.code)) return ERROR_MESSAGES[error.code]
  if (error.status >= 500) return SERVER_ERROR_MESSAGE
  return GENERIC_ERROR_MESSAGE
}
