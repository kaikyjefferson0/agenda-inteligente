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
| `POST /professionals/me` | Dono passa a atender | Dono | `201`, ou `200` se o registro já existir | UC04 |
| `POST /professionals/{id}/deactivate` | Desativa profissional | Dono | `204` | UC04 |
| `PUT /professionals/{id}/services` | Define serviços atendidos | Dono | `200` | UC07 |
| `GET /professionals/{id}/working-hours` | Lê expediente | Dono ou o próprio | `200` | UC08 |
| `PUT /professionals/{id}/working-hours` | Substitui expediente | Dono ou o próprio | `200` | UC08 |
| `GET /professionals/{id}/time-blocks` | Lista bloqueios | Dono ou o próprio | `200` | UC09 |
| `POST /professionals/{id}/time-blocks` | Cria bloqueio | Dono ou o próprio | `201` | UC09 |
| `DELETE /time-blocks/{id}` | Remove bloqueio | Dono ou o próprio | `204` | UC09 |

`POST /professionals/invitations` devolve `professional_id`, `email` e `expires_at`, nunca o token. Acima do limite de convites ou de e-mail, responde `429` sem criar nada (RN26).

### Negócio e serviços

- `PATCH /business` e `PATCH /services/{id}` alteram só os campos enviados. Um `null` explícito responde `422`, e um corpo vazio responde `200`, sem alterar nada.
- A resposta de `PATCH /business` inclui `appointments_outside_hours`. Ao trocar o fuso, a lista traz os agendamentos futuros confirmados de todos os profissionais que ficaram fora do expediente no novo fuso (RN22). Sem troca de fuso, a lista vem vazia.
- A antecedência mínima não pode superar a máxima. Em um `PATCH` parcial, o campo não enviado vale pelo valor guardado.
- No negócio demo, `DEMO_RESTRICTED` só se aplica quando `name` ou `slug` do negócio, ou `name` do serviço, mudam de valor (RN28).
- Não há exclusão de serviço. `PATCH /services/{id}` com `is_active: false` o retira das novas reservas, e `GET /services` lista também os inativos.

| Campo | Faixa |
|---|---|
| `slot_step_minutes` | 5, 10, 15, 20, 30 ou 60 |
| `min_advance_minutes` | 0 a 525600 (365 dias) |
| `max_advance_days` | 1 a 365 |
| `change_deadline_minutes` | 0 a 43200 (30 dias) |
| `duration_minutes` | 1 a 1440 |
| `preparation_minutes` | 0 a 1440, com padrão 0 |
| `price_cents` | 0 a 100000000 (R$ 1 milhão) |
| `name` | 1 a 120 caracteres |

### Equipe

- `GET /professionals` e `PUT /professionals/{id}/services` devolvem `id`, `user_id`, `name`, `email`, `is_bookable`, `is_active`, `invitation_pending` e `service_ids`. É assim que se leem os serviços de um profissional.
- `POST /professionals/me` cria o registro do Dono. Se ele já existir, responde `200` e o deixa com `is_bookable = true`, o que também traz de volta o Dono que deixou de atender.
- `PUT /professionals/{id}/services` recebe `{"service_ids": [...]}`. Serviço inexistente ou de outro negócio responde `404`, sem alterar nada. Serviço inativo é aceito, porque a RN07 se aplica na reserva, e IDs repetidos contam uma vez.
- `POST /professionals/{id}/deactivate` responde `409 APPOINTMENT_CONFLICTS` enquanto houver agendamentos confirmados com início no futuro (RN23). Atendimento em andamento não impede. Repetir a chamada responde `204`.
- Na V1, a desativação de um profissional é definitiva: não há rota para reativar, e o e-mail continua em uso (RN24). Os links pendentes da conta deixam de funcionar. O Dono mantém o login e volta a atender com `POST /professionals/me`.

### Expediente e bloqueios

`GET` e `PUT /professionals/{id}/working-hours` usam o mesmo formato. `weekday` vai de 0 (segunda) a 6 (domingo), e as horas são locais, em minutos inteiros e sem fuso. A lista vazia limpa o expediente.

```json
{
  "intervals": [
    { "weekday": 0, "start_time": "09:00", "end_time": "12:00" },
    { "weekday": 0, "start_time": "13:00", "end_time": "18:00" }
  ]
}
```

- A resposta do `PUT` inclui `appointments_outside_hours`, com os agendamentos futuros confirmados do profissional cujo bloco, com o preparo, não cabe em um único intervalo (RN03, RN22).
- Intervalos encostados, como 09:00–12:00 e 12:00–18:00, são aceitos e guardados como enviados. Por isso, um atendimento não pode atravessar as 12:00. Intervalos sobrepostos ou com fim antes do início respondem `422`.
- `POST /professionals/{id}/time-blocks` recebe `starts_at`, `ends_at`, ambos com fuso, e `reason`, de 1 a 500 caracteres. A resposta traz `id`, `professional_id`, `starts_at`, `ends_at` e `reason`. Bloqueio no passado é aceito.
- O bloqueio responde `409 APPOINTMENT_CONFLICTS` se sobrepuser o período `[starts_at, blocked_until)` de um agendamento não cancelado (RN04, RN21). Se também sobrepuser outro bloqueio, esse código tem prioridade.
- `GET /professionals/{id}/time-blocks`, `GET /professionals` e `GET /services` devolvem listas simples e ordenadas, sem paginação nem filtros.

### Agendamentos nas respostas

`conflicts` e `appointments_outside_hours` têm o mesmo formato, sem e-mail nem telefone do cliente:

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "professional_id": "5d0c7e42-0000-4000-8000-000000000002",
  "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
  "starts_at": "2026-11-10T12:00:00Z",
  "ends_at": "2026-11-10T12:30:00Z",
  "blocked_until": "2026-11-10T12:40:00Z",
  "status": "confirmed",
  "customer_name": "Cliente de Exemplo"
}
```

Nas rotas de administração, os instantes são devolvidos em UTC, e o frontend os converte para o fuso do negócio.

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

Nas rotas públicas, os instantes são devolvidos com o deslocamento do fuso do negócio, e não em UTC. Assim, as duas ocorrências de um horário ambíguo ficam distintas.

Valem para as rotas públicas de negócio:

- Serviço inexistente, inativo ou de outro negócio responde `404`, assim como `slug` inexistente, que não diferencia maiúsculas.
- Profissional inexistente ou de outro negócio responde `404`. Profissional que não atende o serviço ou com `is_bookable = false` responde `422`.
- Limites por IP, com contadores separados: 120 por minuto na página e na disponibilidade, e 10 por hora na criação. Toda requisição conta, inclusive repetições, `404` e `422`. A exceção é JSON malformado, recusado antes da contagem.

### Exemplo: página do negócio

```json
{
  "name": "Barbearia Demo",
  "slug": "barbearia-demo",
  "timezone": "America/Sao_Paulo",
  "is_demo": true,
  "min_advance_minutes": 60,
  "max_advance_days": 30,
  "services": [
    {
      "id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
      "name": "Corte",
      "duration_minutes": 30,
      "price_cents": 5000,
      "professional_ids": ["5d0c7e42-0000-4000-8000-000000000002"]
    }
  ],
  "professionals": [
    { "id": "5d0c7e42-0000-4000-8000-000000000002", "name": "Profissional Demo" }
  ]
}
```

`services` traz os serviços ativos, mesmo sem profissional. `professionals` traz os aptos pela RN07, mesmo sem expediente.

### Exemplo: disponibilidade

```json
{
  "date": "2026-11-10",
  "slots": [{ "starts_at": "2026-11-10T09:00:00-03:00" }]
}
```

`service_id` e `date` são obrigatórios. Dia fora da antecedência responde `200`, com a lista vazia.

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

- `Idempotency-Key` é obrigatória e precisa ser um UUID com hifens, de qualquer versão. Ausente ou inválida, responde `422`.
- `customer.name` tem de 1 a 120 caracteres, sem caracteres de controle, e `customer.phone` segue o formato E.164, como no exemplo. O frontend converte o que for digitado.
- `starts_at` fora da grade responde `422 VALIDATION_ERROR`, inclusive na segunda ocorrência de um horário ambíguo. Na grade, mas ocupado, fora do expediente ou da antecedência, responde `409 SLOT_UNAVAILABLE`.
- `email_status` pode ser `queued` ou `skipped`, quando um limite de envio foi atingido (RN26).
- Em uma repetição idempotente, a resposta é `200`, com o mesmo agendamento, `access_url: null` e `email_status: "unchanged"` (RN13).
- Se o limite de e-mail impediu o envio na criação, a repetição responde `200`, com o mesmo agendamento, um novo `access_url` e `email_status: "skipped"`. O link anterior deixa de funcionar, e nenhum e-mail é enfileirado (RN13, RN26).
- A idempotência garante que o agendamento não é duplicado. A troca do token é um efeito colateral aceito nesse caso.
- Mesma chave com dados diferentes responde `409 IDEMPOTENCY_KEY_REUSED`. A comparação usa os dados como foram enviados, depois de validados: o mesmo instante com outro deslocamento e o e-mail com outra caixa contam como dados diferentes.
- A chave só fica registrada quando o agendamento é criado. Depois de uma recusa, ela pode ser usada de novo.

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
