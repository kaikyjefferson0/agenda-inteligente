import { ApiError } from '@/api/errors'
import { ERROR_MESSAGES, errorMessage } from '@/api/messages'
import { formatDuration } from '@/lib/format'

import type { EmailStatus, SlotRefusal } from './queries'
import { formatRanges, type Range, type SlotProblem } from './slot-check'

/** The `reason` of a `409 SLOT_UNAVAILABLE` of the team routes (D77), or `null`. */
export function slotRefusalOf(error: unknown): SlotRefusal | null | undefined {
  if (!(error instanceof ApiError) || error.code !== 'SLOT_UNAVAILABLE') return undefined
  const reason = error.body?.reason
  return typeof reason === 'string' ? (reason as SlotRefusal) : null
}

/**
 * What the team reads for each `reason` (D83). The text comes from the value,
 * never from `detail`, and names the professional who would get the slot.
 */
export function refusalMessage(reason: SlotRefusal | null, professional: string): string {
  switch (reason) {
    case 'changed_meanwhile':
      return 'Outra pessoa alterou este agendamento enquanto você remarcava. Ele foi recarregado: confira os dados e, se ainda precisar, remarque de novo.'
    case 'in_past':
      return 'Este horário já passou. Escolha um horário a partir de agora.'
    case 'outside_working_hours':
      return `O atendimento, com o preparo, não cabe no expediente de ${professional} neste dia. Escolha um horário dentro das faixas livres.`
    case 'blocked':
      return `Este horário cai num bloqueio de ${professional}. Escolha outro horário.`
    case 'appointment_conflict':
      return `Este horário coincide com outro agendamento de ${professional}. Escolha outro horário.`
    default:
      return ERROR_MESSAGES.SLOT_UNAVAILABLE
  }
}

/** The text below the time field, before anything is sent (D82). */
export function slotProblemMessage(
  problem: SlotProblem,
  {
    professional,
    working,
    durationMinutes,
    preparationMinutes,
  }: {
    professional: string
    working: Range[] | undefined
    durationMinutes: number
    preparationMinutes: number
  },
): string {
  switch (problem) {
    case 'invalid':
      return 'Informe a hora, como 09:30.'
    case 'nonexistent':
      return 'Este horário não existe neste dia: o relógio foi adiantado na mudança de horário.'
    case 'in_past':
      return 'Este horário já passou.'
    case 'outside_working_hours': {
      if (working === undefined || working.length === 0) {
        return `${professional} não tem expediente neste dia.`
      }
      const block =
        preparationMinutes > 0
          ? `Os ${formatDuration(durationMinutes)} do atendimento, mais ${formatDuration(preparationMinutes)} de preparo,`
          : `Os ${formatDuration(durationMinutes)} do atendimento`
      return `Fora do expediente de ${professional}. ${block} precisam caber inteiros em ${formatRanges(working)}.`
    }
  }
}

export type AgendaAction = 'created' | 'rescheduled' | 'cancelled'

const EMAIL_NOTES: Record<AgendaAction, Record<EmailStatus, string>> = {
  created: {
    queued: 'O cliente vai receber o link do agendamento por e-mail.',
    skipped:
      'O limite de envio de e-mails foi atingido, e o e-mail não saiu. Copie o link acima e envie ao cliente: ele só aparece agora.',
    none: 'Sem e-mail, o cliente não recebe link. Só a equipe consegue alterar este agendamento.',
  },
  rescheduled: {
    queued: 'O cliente foi avisado do novo horário por e-mail. O link que ele já tem continua valendo.',
    skipped: 'O cliente não foi avisado: o limite de envio de e-mails foi atingido. Avise por outro meio.',
    none: 'O agendamento não tem e-mail: avise o cliente do novo horário por outro meio.',
  },
  cancelled: {
    queued: 'O cliente foi avisado por e-mail.',
    skipped: 'O cliente não foi avisado: o limite de envio de e-mails foi atingido. Avise por outro meio.',
    none: 'O agendamento não tem e-mail: avise o cliente por outro meio.',
  },
}

/** What the e-mail did after a change (RN25, RN26). */
export function emailNote(action: AgendaAction, status: EmailStatus): string {
  return EMAIL_NOTES[action][status]
}

/**
 * Refusals that a new attempt cannot fix, because the appointment itself
 * changed: no longer confirmed (`409 INVALID_STATUS_TRANSITION`) or gone
 * (`404`). The agenda is read again and the sheet says why (D84).
 */
export function isFinalRefusal(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 404 || error.code === 'INVALID_STATUS_TRANSITION')
  )
}

export function finalRefusalMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) {
    return 'Este agendamento não existe mais. A agenda foi atualizada.'
  }
  if (error instanceof ApiError && error.code === 'INVALID_STATUS_TRANSITION') {
    return 'A situação deste agendamento não permite esta ação agora. A agenda foi atualizada.'
  }
  return errorMessage(error)
}
