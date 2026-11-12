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

Essas rotas não têm limite por IP, como as demais rotas de administração. As cotas de e-mail (RN26) continuam valendo (D33).

### Exemplo: agenda

```http
GET /api/v1/appointments?from=2026-11-10T03:00:00Z&to=2026-11-11T03:00:00Z
```

```json
[
  {
    "id": "a1b2c3d4-0000-4000-8000-000000000001",
    "professional_id": "5d0c7e42-0000-4000-8000-000000000002",
    "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
    "service_name": "Corte",
    "starts_at": "2026-11-10T12:00:00Z",
    "ends_at": "2026-11-10T12:30:00Z",
    "blocked_until": "2026-11-10T12:40:00Z",
    "duration_minutes": 30,
    "preparation_minutes": 10,
    "price_cents": 5000,
    "status": "confirmed",
    "origin": "public",
    "customer_name": "Cliente de Exemplo",
    "customer_email": "cliente@example.com",
    "customer_phone": "+5511999999999",
    "cancelled_at": null
  }
]
```

- `from` e `to` são obrigatórios, em ISO 8601 com fuso, e formam o intervalo semiaberto `[from, to)`, de no máximo 31 × 24 horas. Entra o agendamento com `starts_at` no período (D25).
- A lista traz todos os status, inclusive cancelados, ordenados por `starts_at` e `id`, sem paginação.
- Sem `professional_id`, o Dono vê todas as agendas, e o Profissional, a própria.
- `service_name` é o nome atual do serviço; duração, preparo e preço são os copiados no agendamento (RN11). A resposta nunca traz o hash do token nem os campos de idempotência (D26).

### Exemplo: criação manual

```http
POST /api/v1/appointments
Content-Type: application/json

{
  "professional_id": "5d0c7e42-0000-4000-8000-000000000002",
  "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
  "starts_at": "2026-11-10T12:07:00Z",
  "customer": {
    "name": "Cliente de Exemplo",
    "email": "cliente@example.com",
    "phone": "+5511999999999"
  }
}
```

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000003",
  "professional_id": "5d0c7e42-0000-4000-8000-000000000002",
  "service_id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
  "service_name": "Corte",
  "starts_at": "2026-11-10T12:07:00Z",
  "ends_at": "2026-11-10T12:37:00Z",
  "blocked_until": "2026-11-10T12:47:00Z",
  "duration_minutes": 30,
  "preparation_minutes": 10,
  "price_cents": 5000,
  "status": "confirmed",
  "origin": "staff",
  "customer_name": "Cliente de Exemplo",
  "customer_email": "cliente@example.com",
  "customer_phone": "+5511999999999",
  "cancelled_at": null,
  "access_url": "https://app.exemplo.com/agendamento/<token>",
  "email_status": "queued"
}
```

- Só `customer.name` é obrigatório, com as regras da página pública; `email` e `phone` são opcionais e, quando enviados, seguem as mesmas validações (D9).
- `starts_at` pode ser qualquer minuto exato, sem grade nem antecedência (RN19), mas não pode ter segundos nem frações de segundo.
- Não há `Idempotency-Key`. A exclusion constraint impede que uma repetição crie outro agendamento no mesmo horário (RN14).
- Com e-mail, o cliente recebe o link, como na reserva pública (D10). Sem e-mail, não há link (D29).
- A remarcação recebe `starts_at` (obrigatório) e `professional_id` (opcional; ausente ou `null` mantém o atual, sem a RN10). Ela troca o horário na mesma linha, mantém serviço, valores copiados e o link do cliente, e pode sobrepor o próprio horário atual (D30).
- O cancelamento, a conclusão e o não comparecimento não têm corpo. A remarcação e o cancelamento respondem com o item da agenda mais `email_status`; a conclusão e o não comparecimento, só com o item da agenda (D31, D32).

`email_status`:

- **`queued`:** o e-mail foi enfileirado. Na criação, é o de confirmação, com o link; no cancelamento e na remarcação, os da D23. O de remarcação feito pela equipe não leva o link, porque só o hash é guardado, e informa que o link já recebido continua válido (D31).
- **`skipped`:** um limite de envio foi atingido. A operação vale do mesmo jeito, e nada é enfileirado (RN26). Na criação, o link vem só na resposta, e o agendamento fica com `link_email_skipped = true` (D29).
- **`none`:** o agendamento não tem e-mail, então não há a quem avisar e nenhuma cota é gasta. Na criação, `access_url` vem `null`.

Recusas. Antes delas, um corpo ou parâmetro com formato inválido ou campo desconhecido responde `422`:

- **Período (D25):** `to <= from` ou intervalo acima de 31 × 24 horas responde `422`.
- **Permissão (D27):** Profissional que pede a agenda de colega, ou cria, altera ou marca resultado em agendamento de colega, recebe `403 FORBIDDEN`. Agendamento, profissional ou serviço de outro negócio responde `404`, igual a inexistente.
- **Dados da criação e da remarcação (D28, D30):** serviço inativo, profissional que não atende o serviço ou com `is_bookable = false` e `starts_at` com segundos respondem `422`. Na remarcação pela equipe, o serviço inativo também responde `422`, como na criação manual; no link do cliente, o mesmo caso responde `409` (D21), porque o cliente não precisa saber o motivo.
- **Horário (D28, D30):** no passado, fora do expediente (o bloco inteiro em um intervalo, RN03), sobre agendamento não cancelado ou sobre bloqueio responde `409 SLOT_UNAVAILABLE`, com o motivo em `reason` (D77). Na remarcação, o agendamento original fica intacto.
- **Status (D30, D31):** remarcar ou cancelar fora de `confirmed`, inclusive cancelar duas vezes, responde `409 INVALID_STATUS_TRANSITION`. Não há prazo: a equipe cancela inclusive depois do início (RN20).
- **Resultado (D32):** concluir ou marcar não comparecimento fora de `confirmed` ou antes de `starts_at` responde `409 INVALID_STATUS_TRANSITION`. No instante exato do início, é aceito.

### Motivo do `409 SLOT_UNAVAILABLE` (D77)

Na criação manual e na remarcação pela equipe, o `409 SLOT_UNAVAILABLE` traz o campo `reason`, e o `detail` diz o motivo em português:

| `reason` | Quando | `detail` |
|---|---|---|
| `changed_meanwhile` | Só na remarcação sem `professional_id`: outra alteração mudou o profissional do agendamento enquanto a requisição esperava os locks, e o horário não chegou a ser conferido | O agendamento foi alterado por outra pessoa durante a remarcação. Atualize a agenda e tente de novo. |
| `in_past` | `starts_at` antes de agora (RN19) | Este horário já passou. |
| `outside_working_hours` | O bloco, com o preparo, não cabe em um intervalo do expediente (RN03, RN19) | O atendimento, com o preparo, não cabe em um intervalo do expediente do profissional. |
| `blocked` | O bloco sobrepõe um bloqueio do profissional (RN04) | Este horário cai em um bloqueio do profissional. |
| `appointment_conflict` | O bloco sobrepõe outro agendamento não cancelado (RN04, RN14) | Este horário coincide com outro agendamento do profissional. |

```json
{
  "type": "https://api.exemplo.com/problems/slot-unavailable",
  "title": "Horário indisponível",
  "status": 409,
  "code": "SLOT_UNAVAILABLE",
  "detail": "O atendimento, com o preparo, não cabe em um intervalo do expediente do profissional.",
  "reason": "outside_working_hours"
}
```

- **Ordem:** quando mais de um motivo vale, vem o primeiro de `changed_meanwhile`, `in_past`, `outside_working_hours`, `blocked` e `appointment_conflict`. `changed_meanwhile` vem antes de todos porque é decidido antes de conferir o horário: com ele, nenhum dos outros chega a ser avaliado. O passado e o expediente são conferidos antes de consultar a agenda; o bloqueio vem antes do agendamento porque é uma ausência do próprio profissional, que outro horário no mesmo período não resolve.
- **`changed_meanwhile` pede outra reação:** o horário pedido pode estar livre, mas o agendamento já não é o que a tela mostrava. O cliente da API relê o agendamento em vez de oferecer outros horários. A diferença está no valor de `reason`, nunca só no texto do `detail`.
- **Remarcação:** o motivo é sobre o profissional que receberia o agendamento.
- **Concorrência:** quando a exclusion constraint recusa a gravação (RN14), o motivo é `appointment_conflict`, porque ela só existe entre agendamentos.
- **Rotas públicas:** a reserva e a remarcação pelo link continuam com o `409 SLOT_UNAVAILABLE` genérico, sem `reason` e com o `detail` "Este horário acabou de ser reservado.", para não revelar ao cliente o expediente, os bloqueios e a ocupação do negócio.
- **OpenAPI e tipo de conteúdo:** o `409` das duas rotas é o schema `StaffConflictProblem`, com `reason` do tipo `SlotRefusal`. O OpenAPI o lista como `application/json`, como faz com o `422`, mas a resposta real sai como `application/problem+json`, como todo erro da API. `tests/appointments/test_refusal_reasons.py` confere o `Content-Type` em cada motivo.

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
- `starts_at` fora da grade responde `422 VALIDATION_ERROR`, inclusive na segunda ocorrência de um horário ambíguo. Na grade, mas ocupado, fora do expediente ou da antecedência, responde `409 SLOT_UNAVAILABLE`, sem `reason` (D77).
- `email_status` pode ser `queued` ou `skipped`, quando um limite de envio foi atingido (RN26).
- Em uma repetição idempotente, a resposta é `200`, com o mesmo agendamento, `access_url: null` e `email_status: "unchanged"` (RN13).
- Se o limite de e-mail impediu o envio na criação, a repetição responde `200`, com o mesmo agendamento, um novo `access_url` e `email_status: "skipped"`. O link anterior deixa de funcionar, e nenhum e-mail é enfileirado (RN13, RN26).
- A idempotência garante que o agendamento não é duplicado. A troca do token é um efeito colateral aceito nesse caso.
- Mesma chave com dados diferentes responde `409 IDEMPOTENCY_KEY_REUSED`. A comparação usa os dados como foram enviados, depois de validados: o mesmo instante com outro deslocamento e o e-mail com outra caixa contam como dados diferentes.
- A chave só fica registrada quando o agendamento é criado. Depois de uma recusa, ela pode ser usada de novo.

### Link do cliente

`GET /public/appointments/{token}`, `POST /public/appointments/{token}/cancel` e `POST /public/appointments/{token}/reschedule` respondem `200`. O token é o último segmento de `access_url` e é procurado pelo hash.

#### Exemplo: consulta pelo link

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "status": "confirmed",
  "starts_at": "2026-11-10T09:00:00-03:00",
  "ends_at": "2026-11-10T09:30:00-03:00",
  "business": {
    "name": "Barbearia Demo",
    "slug": "barbearia-demo",
    "timezone": "America/Sao_Paulo"
  },
  "service": {
    "id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
    "name": "Corte",
    "duration_minutes": 30,
    "price_cents": 5000
  },
  "professional": { "id": "5d0c7e42-0000-4000-8000-000000000002", "name": "Profissional Demo" },
  "can_cancel": true,
  "can_reschedule": true,
  "change_deadline_at": "2026-11-10T07:00:00-03:00"
}
```

- O nome do serviço é o atual; `duration_minutes` e `price_cents` são os copiados na reserva (RN11).
- `change_deadline_at` é o início atual menos o prazo de alteração do negócio (RN17), no fuso do negócio.
- `can_cancel` vale `true` com o agendamento `confirmed` e dentro do prazo; `can_reschedule` exige, além disso, o serviço ativo (D21).
- A resposta não traz nenhum dado do cliente: nem nome, nem e-mail, nem telefone.

#### Exemplo: remarcar

```http
POST /api/v1/public/appointments/<token>/reschedule
Content-Type: application/json

{
  "starts_at": "2026-11-10T14:00:00-03:00",
  "professional_id": null
}
```

```json
{
  "id": "a1b2c3d4-0000-4000-8000-000000000001",
  "status": "confirmed",
  "starts_at": "2026-11-10T14:00:00-03:00",
  "ends_at": "2026-11-10T14:30:00-03:00",
  "business": {
    "name": "Barbearia Demo",
    "slug": "barbearia-demo",
    "timezone": "America/Sao_Paulo"
  },
  "service": {
    "id": "2c9e7d1a-6b1f-4f7e-9a51-3d8f1b7e4c20",
    "name": "Corte",
    "duration_minutes": 30,
    "price_cents": 5000
  },
  "professional": { "id": "5d0c7e42-0000-4000-8000-000000000002", "name": "Profissional Demo" },
  "can_cancel": true,
  "can_reschedule": true,
  "change_deadline_at": "2026-11-10T12:00:00-03:00",
  "email_status": "queued"
}
```

- `starts_at` é obrigatório. `professional_id` é opcional: `null` segue a RN10, e a contagem do dia ignora o próprio agendamento.
- A remarcação é uma troca atômica na mesma linha, com o mesmo link e os mesmos valores copiados (RN18). O cancelamento não tem corpo e responde no mesmo formato, com `status: "cancelled"`.
- `email_status` vale `queued` quando o e-mail de cancelamento ou de remarcação foi enfileirado, ou `skipped` quando um limite de envio foi atingido. Nesse caso, a operação vale do mesmo jeito e nada é enfileirado (RN26). Os e-mails não levam o nome do cliente, e o de remarcação leva o mesmo link.
- A remarcação não usa `Idempotency-Key`: repeti-la cai sobre o próprio horário e responde `409`.

Recusas, em ordem. Antes delas, um corpo com formato inválido ou campo desconhecido responde `422`, sem consultar o token:

- **Link inválido (D18):** token inexistente, malformado, adulterado, substituído ou expirado, mais de 30 dias depois do início, responde `404 NOT_FOUND`, sempre com o mesmo corpo.
- **Status (D19):** agendamento fora de `confirmed`, inclusive já cancelado, responde `409 INVALID_STATUS_TRANSITION`.
- **Prazo (D19):** `agora > início atual - prazo` responde `409 CHANGE_DEADLINE_PASSED`. O limite exato é permitido.
- **Serviço desativado (D21):** a remarcação responde `409 SLOT_UNAVAILABLE`; o cancelamento continua permitido.
- **Corpo da remarcação (D20):** `starts_at` fora da grade, `422`; profissional inexistente ou de outro negócio, `404`; profissional que não atende o serviço ou com `is_bookable = false`, `422`; horário ocupado, fora do expediente, fora da antecedência ou sobrepondo o horário atual, `409 SLOT_UNAVAILABLE`, sem `reason` (D77). Em qualquer recusa, o agendamento original fica intacto.
- **Limite (D22):** as três rotas compartilham um contador de 60 requisições por minuto por IP, e toda requisição conta, inclusive `404` e `422`. Acima dele, `429` com `Retry-After`.

Todas as respostas dessas rotas, inclusive as de erro, levam `Cache-Control: no-store` e `Referrer-Policy: no-referrer` (D22). A exceção é o `500 INTERNAL_ERROR` genérico, montado pelo Starlette fora do middleware que acrescenta esses cabeçalhos: ele sai sem eles, mas tem corpo fixo, sem o token nem dados do agendamento. O log de acesso registra o caminho com o token trocado por `***` (D24).

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
| `409` | `SLOT_UNAVAILABLE` | Horário ocupado, horário no passado, fora do expediente ou da antecedência; nas rotas da equipe, inclui `reason` (D77) |
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
