import logging
from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.domain.errors import AppError, ErrorCode, SlotRefusal
from app.schemas.schedule import AppointmentData

logger = logging.getLogger(__name__)

PROBLEM_MEDIA_TYPE = "application/problem+json"
PROBLEM_BASE_URL = "https://api.exemplo.com/problems"


@dataclass(frozen=True)
class Problem:
    status: int
    title: str
    detail: str


PROBLEMS: dict[ErrorCode, Problem] = {
    ErrorCode.INVALID_TOKEN: Problem(
        400, "Link inválido", "O link é inválido, expirou ou já foi usado."
    ),
    ErrorCode.INVALID_CREDENTIALS: Problem(
        401, "Credenciais inválidas", "E-mail ou senha incorretos."
    ),
    ErrorCode.NOT_AUTHENTICATED: Problem(
        401, "Não autenticado", "Faça login para continuar."
    ),
    ErrorCode.INVALID_REFRESH_TOKEN: Problem(
        401, "Sessão inválida", "A sessão expirou. Faça login novamente."
    ),
    ErrorCode.FORBIDDEN: Problem(
        403, "Sem permissão", "Você não tem permissão para esta operação."
    ),
    ErrorCode.REGISTRATION_DISABLED: Problem(
        403, "Cadastro desligado", "O cadastro de novos negócios está desligado."
    ),
    ErrorCode.DEMO_RESTRICTED: Problem(
        403, "Operação travada na demo", "Esta operação não está disponível na demo."
    ),
    ErrorCode.NOT_FOUND: Problem(
        404, "Não encontrado", "O recurso solicitado não foi encontrado."
    ),
    ErrorCode.SLOT_UNAVAILABLE: Problem(
        409, "Horário indisponível", "Este horário acabou de ser reservado."
    ),
    ErrorCode.CHANGE_DEADLINE_PASSED: Problem(
        409,
        "Prazo de alteração vencido",
        "O prazo para alterar este agendamento passou. Fale com o negócio.",
    ),
    ErrorCode.INVALID_STATUS_TRANSITION: Problem(
        409,
        "Alteração não permitida",
        "O status atual do agendamento não permite esta alteração.",
    ),
    ErrorCode.IDEMPOTENCY_KEY_REUSED: Problem(
        409,
        "Chave de idempotência já usada",
        "Esta chave já foi usada com dados diferentes.",
    ),
    ErrorCode.APPOINTMENT_CONFLICTS: Problem(
        409,
        "Agendamentos em conflito",
        "Resolva os agendamentos listados antes de continuar.",
    ),
    ErrorCode.TIME_BLOCK_OVERLAP: Problem(
        409, "Bloqueio sobreposto", "Já existe um bloqueio nesse período."
    ),
    ErrorCode.INVITATION_NOT_PENDING: Problem(
        409,
        "Convite não pendente",
        "Só um convite ainda pendente pode ser cancelado: este já foi aceito, "
        "ou a conta foi desativada.",
    ),
    ErrorCode.EMAIL_IN_USE: Problem(
        409, "E-mail em uso", "Este e-mail já está em uso."
    ),
    ErrorCode.SLUG_IN_USE: Problem(
        409, "Endereço em uso", "Este endereço já está em uso."
    ),
    ErrorCode.VALIDATION_ERROR: Problem(
        422, "Dados inválidos", "Confira os dados enviados."
    ),
    ErrorCode.RATE_LIMITED: Problem(
        429, "Limite excedido", "Muitas tentativas. Aguarde e tente novamente."
    ),
    ErrorCode.DATABASE_UNAVAILABLE: Problem(
        503,
        "Banco de dados indisponível",
        "Não foi possível acessar o banco de dados.",
    ),
    ErrorCode.INTERNAL_ERROR: Problem(
        500, "Erro interno", "Ocorreu um erro inesperado."
    ),
}


# D77: the detail of SLOT_UNAVAILABLE on the team's routes, one per reason.
# The public routes keep the generic detail above, without a reason.
SLOT_REFUSAL_DETAILS: dict[SlotRefusal, str] = {
    SlotRefusal.CHANGED_MEANWHILE: (
        "O agendamento foi alterado por outra pessoa durante a remarcação. "
        "Atualize a agenda e tente de novo."
    ),
    SlotRefusal.IN_PAST: "Este horário já passou.",
    SlotRefusal.OUTSIDE_WORKING_HOURS: (
        "O atendimento, com o preparo, não cabe em um intervalo do expediente "
        "do profissional."
    ),
    SlotRefusal.BLOCKED: "Este horário cai em um bloqueio do profissional.",
    SlotRefusal.APPOINTMENT_CONFLICT: (
        "Este horário coincide com outro agendamento do profissional."
    ),
}


def _problem_body(
    code: ErrorCode, status: int, title: str, detail: str
) -> dict[str, Any]:
    slug = code.value.lower().replace("_", "-")
    return {
        "type": f"{PROBLEM_BASE_URL}/{slug}",
        "title": title,
        "status": status,
        "code": code.value,
        "detail": detail,
    }


def problem_response(
    code: ErrorCode,
    *,
    extra: dict[str, Any] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    problem = PROBLEMS[code]
    body = _problem_body(code, problem.status, problem.title, problem.detail)
    return JSONResponse(
        status_code=problem.status,
        content={**body, **(extra or {})},
        media_type=PROBLEM_MEDIA_TYPE,
        headers=headers,
    )


def _app_error_extra(error: AppError) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    if error.reason is not None:
        extra["reason"] = error.reason.value
        extra["detail"] = SLOT_REFUSAL_DETAILS[error.reason]
    if error.conflicts is not None:
        extra["conflicts"] = [
            AppointmentData.model_validate(appointment).model_dump(mode="json")
            for appointment in error.conflicts
        ]
    if error.invalid_field is not None:
        field, message = error.invalid_field
        extra["errors"] = [
            {
                "loc": [error.invalid_location, field],
                "msg": message,
                "type": "value_error",
            }
        ]
    return extra


def app_error_response(error: AppError) -> JSONResponse:
    headers: dict[str, str] = {}
    if error.retry_after is not None:
        headers["Retry-After"] = str(error.retry_after)
    if error.code is ErrorCode.NOT_AUTHENTICATED:
        headers["WWW-Authenticate"] = "Bearer"
    return problem_response(error.code, extra=_app_error_extra(error), headers=headers)


async def _handle_app_error(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, AppError)
    return app_error_response(error)


async def _handle_validation_error(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, RequestValidationError)
    # Only these fields: the default output echoes the input, including passwords.
    errors = [
        {"loc": list(item["loc"]), "msg": item["msg"], "type": item["type"]}
        for item in error.errors()
    ]
    return problem_response(ErrorCode.VALIDATION_ERROR, extra={"errors": errors})


async def _handle_http_exception(_: Request, error: Exception) -> JSONResponse:
    assert isinstance(error, HTTPException)
    if error.status_code == HTTPStatus.NOT_FOUND:
        return problem_response(ErrorCode.NOT_FOUND, headers=error.headers)
    phrase = HTTPStatus(error.status_code).phrase
    return JSONResponse(
        status_code=error.status_code,
        content=_problem_body(
            ErrorCode.HTTP_ERROR, error.status_code, phrase, str(error.detail)
        ),
        media_type=PROBLEM_MEDIA_TYPE,
        headers=error.headers,
    )


async def _handle_unexpected_error(_: Request, error: Exception) -> JSONResponse:
    logger.error("Unhandled error: %s", type(error).__name__)
    return problem_response(ErrorCode.INTERNAL_ERROR)


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _handle_app_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(HTTPException, _handle_http_exception)
    app.add_exception_handler(Exception, _handle_unexpected_error)
