# 7. API

Este documento define o contrato inicial. Depois da implementação, o OpenAPI gerado pelo FastAPI passa a ser a referência de campos, e os tipos do frontend são gerados a partir dele.

## Convenções

- **Prefixo:** `/api/v1`, exceto `GET /health`.
- **Negócio:** nas rotas autenticadas, vem da sessão, nunca da URL.
- **Datas:** ISO 8601 com fuso. Datas sem hora, como em `availability`, são dias locais do negócio.
- **Autenticação:** `Authorization: Bearer <token>`. O refresh fica em um cookie HttpOnly.
- **Cookies:** as rotas `/auth/refresh` e `/auth/logout` exigem o cabeçalho `X-Requested-With`, com qualquer valor não vazio, como proteção contra CSRF. Sem ele, respondem `403 FORBIDDEN`, sem tocar no token.
- **Erros:** seguem a RFC 9457 (`application/problem+json`), com um `code` estável.
- **Link do cliente:** o token nunca aparece nos logs, e a página usa `Referrer-Policy: no-referrer`.

Exemplo de erro:

```json
{
  "type": "https://api.exemplo.com/problems/slot-unavailable",
  "title": "Horário indisponível",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "Este horário acabou de ser reservado."
}
```

## Autenticação

| Rota | Função | Acesso | Sucesso | UC |
|---|---|---|---|---|
| `POST /auth/register` | Cria negócio e Dono | Público, se habilitado | `201` | UC01 |
| `POST /auth/login` | Inicia sessão | Público | `200` | UC02 |
| `POST /auth/refresh` | Renova sessão, com rotação | Cookie | `200` | UC02 |
| `POST /auth/logout` | Revoga a sessão | Cookie | `204` | UC02 |
| `GET /auth/me` | Usuário, negócio e papel atuais | Autenticado | `200` | UC02 |
| `POST /auth/password/forgot` | Solicita recuperação | Público | `202` para qualquer e-mail | UC03 |
| `POST /auth/password/reset` | Define nova senha | Token | `204` | UC03 |
| `POST /auth/invitations/accept` | Aceita convite e define senha | Token | `204` | UC04 |

- `register`, `login` e `refresh` devolvem `access_token`, `token_type` e `expires_in`, gravam o refresh em cookie e usam `Cache-Control: no-store`.
- Acima do limite por IP, `forgot` responde `429`, seja qual for o e-mail, então nada revela se a conta existe. Abaixo dele, responde `202` mesmo quando não enfileira e-mail.
- `reset` e `invitations/accept` recebem o token no corpo, para que ele não apareça em logs de acesso, e não iniciam sessão.
- No cadastro, `slug` tem de 3 a 63 caracteres, com letras minúsculas, números e hifens entre eles. `timezone` é um nome IANA, e a senha segue a RN30.
- Campos desconhecidos são recusados com `422`, inclusive `business_id`.

## Administração

| Rota | Função | Acesso | Sucesso | UC |
|---|---|---|---|---|
| `GET /business` | Lê configurações | Dono | `200` | UC05 |
| `PATCH /business` | Altera configurações | Dono | `200` | UC05 |
| `GET /services` | Lista serviços | Dono, Profissional | `200` | UC06 |
| `POST /services` | Cria serviço | Dono | `201` | UC06 |
| `PATCH /services/{id}` | Edita ou desativa serviço | Dono | `200` | UC06 |
| `GET /professionals` | Lista profissionais | Dono: todos; Profissional: o próprio | `200` | UC04 |
| `POST /professionals/invitations` | Convida profissional | Dono | `202` | UC04 |
| `POST /professionals/me` | Dono passa a atender | Dono | `201` | UC04 |
| `POST /professionals/{id}/deactivate` | Desativa profissional | Dono | `204` | UC04 |
| `PUT /professionals/{id}/services` | Define serviços atendidos | Dono | `200` | UC07 |
| `GET /professionals/{id}/working-hours` | Lê expediente | Dono ou o próprio | `200` | UC08 |
| `PUT /professionals/{id}/working-hours` | Substitui expediente | Dono ou o próprio | `200` | UC08 |
| `GET /professionals/{id}/time-blocks` | Lista bloqueios | Dono ou o próprio | `200` | UC09 |
| `POST /professionals/{id}/time-blocks` | Cria bloqueio | Dono ou o próprio | `201` | UC09 |
| `DELETE /time-blocks/{id}` | Remove bloqueio | Dono ou o próprio | `204` | UC09 |

`POST /professionals/invitations` devolve `professional_id`, `email` e `expires_at`, nunca o token. Acima do limite de convites ou de e-mail, responde `429` sem criar nada (RN26).

`POST /professionals/me`, `POST /professionals/{id}/deactivate` e `GET /professionals` fazem parte do contrato, mas ainda não foram implementadas. Estão pendentes para a próxima fase ([UC04](04-casos-de-uso.md#uc04-adicionar-e-desativar-profissionais)).

A resposta de `PUT /professionals/{id}/working-hours` inclui `appointments_outside_hours`, com os agendamentos que ficaram fora do novo expediente (RN22).

## Agenda da equipe

| Rota | Função | Acesso | Sucesso | UC |
|---|---|---|---|---|
| `GET /appointments?from&to&professional_id` | Agenda por período, com no máximo 31 dias | Dono: todas; Profissional: a própria | `200` | UC15 |
| `POST /appointments` | Criação manual | Dono ou o próprio | `201` | UC16 |
| `POST /appointments/{id}/reschedule` | Remarca sem o prazo do cliente | Dono ou o próprio | `200` | UC17 |
| `POST /appointments/{id}/cancel` | Cancela sem o prazo do cliente | Dono ou o próprio | `200` | UC17 |
| `POST /appointments/{id}/complete` | Marca como concluído | Dono ou o próprio | `200` | UC18 |
| `POST /appointments/{id}/no-show` | Marca como não compareceu | Dono ou o próprio | `200` | UC18 |

## Público

| Rota | Função | Sucesso | UC |
|---|---|---|---|
| `GET /public/businesses/{slug}` | Dados do negócio, serviços ativos e profissionais aptos | `200` | UC10 |
| `GET /public/businesses/{slug}/availability?service_id&date&professional_id` | Horários livres | `200` | UC10 |
| `POST /public/businesses/{slug}/appointments` | Cria agendamento | `201` | UC11 |
| `GET /public/appointments/{token}` | Consulta pelo link | `200` | UC12 |
| `POST /public/appointments/{token}/cancel` | Cancela dentro do prazo | `200` | UC13 |
| `POST /public/appointments/{token}/reschedule` | Remarca dentro do prazo | `200` | UC14 |

`professional_id` é opcional. Sem ele, a disponibilidade reúne os horários de todos os profissionais aptos, e a criação segue a regra de "sem preferência" (RN10).

### Exemplo: criar agendamento

```http
POST /api/v1/public/businesses/barbearia-demo/appointments
Idempotency-Key: 8f14e45f-ceea-467f-a9f7-1d2e3c4b5a69
Content-Type: application/json

{
  "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
  "professional_id": null,
  "starts_at": "2026-11-10T09:00:00-03:00",
  "customer": {
    "name": "Cliente de Exemplo",
    "email": "cliente@example.com",
    "phone": "+5511999999999"
  }
}
```

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "status": "confirmed",
  "starts_at": "2026-11-10T09:00:00-03:00",
  "ends_at": "2026-11-10T09:30:00-03:00",
  "service": { "name": "Corte", "price_cents": 5000 },
  "professional": { "name": "Profissional Demo" },
  "access_url": "https://app.exemplo.com/agendamento/<token>",
  "email_status": "queued"
}
```

- `email_status` pode ser `queued` ou `skipped`, quando um limite de envio foi atingido (RN26).
- Em uma repetição idempotente, a resposta é `200`, com o mesmo agendamento, `access_url: null` e `email_status: "unchanged"` (RN13).
- Se o limite de e-mail impediu o envio na criação, a repetição responde `200`, com o mesmo agendamento, um novo `access_url` e `email_status: "skipped"`. O link anterior deixa de funcionar, e nenhum e-mail é enfileirado (RN13, RN26).
- A idempotência garante que o agendamento não é duplicado. A troca do token é um efeito colateral aceito nesse caso.

## Infraestrutura

| Rota | Função | Sucesso |
|---|---|---|
| `GET /health` | Verifica a API e a conexão com o banco | `200` |

## Códigos de erro

| HTTP | `code` | Quando |
|---|---|---|
| `400` | `INVALID_TOKEN` | Convite ou recuperação inválido, expirado ou já usado |
| `401` | `INVALID_CREDENTIALS` | Login incorreto, conta desativada ou convite não aceito |
| `401` | `NOT_AUTHENTICATED` | Token de acesso ausente, inválido, expirado ou de sessão revogada |
| `401` | `INVALID_REFRESH_TOKEN` | Refresh inválido, expirado ou reutilizado |
| `403` | `FORBIDDEN` | Papel ou agenda sem permissão, ou `X-Requested-With` ausente |
| `403` | `REGISTRATION_DISABLED` | Cadastro desligado |
| `403` | `DEMO_RESTRICTED` | Operação travada no negócio demo |
| `404` | `NOT_FOUND` | Inexistente, de outro negócio ou token inválido |
| `409` | `SLOT_UNAVAILABLE` | Horário ocupado, horário no passado, fora do expediente ou da antecedência |
| `409` | `CHANGE_DEADLINE_PASSED` | Prazo do cliente vencido |
| `409` | `INVALID_STATUS_TRANSITION` | Agendamento em status final ou resultado antes do início |
| `409` | `APPOINTMENT_CONFLICTS` | Bloqueio ou desativação com conflitos; inclui `conflicts` |
| `409` | `TIME_BLOCK_OVERLAP` | Bloqueio sobre outro bloqueio |
| `409` | `EMAIL_IN_USE`, `SLUG_IN_USE` | Valor já usado |
| `409` | `IDEMPOTENCY_KEY_REUSED` | Mesma chave com dados diferentes |
| `422` | `VALIDATION_ERROR` | Dados inválidos, ou profissional que não atende o serviço |
| `429` | `RATE_LIMITED` | Limite excedido; inclui `Retry-After` |
| `4xx` | `HTTP_ERROR` | Erro do protocolo sem código próprio, como método não permitido |
| `500` | `INTERNAL_ERROR` | Erro inesperado, sem detalhes na resposta |
| `503` | `DATABASE_UNAVAILABLE` | `GET /health` não conseguiu acessar o banco |

No negócio demo, `POST /auth/password/forgot` continua respondendo `202`, mas não enfileira e-mail.
