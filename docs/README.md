# Agenda Inteligente: documentação (Fase 0)

Sistema de agendamento online para negócios de beleza e bem-estar. Projeto de portfólio full stack.

**Stack:** FastAPI com uv, PostgreSQL, React + TypeScript + Tailwind + shadcn/ui, Docker e GitHub Actions.

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 1 | [Visão do produto](01-visao-produto.md) | Problema, público-alvo, escopo da V1 e critérios de sucesso |
| 2 | [Perfis de usuário](02-perfis-usuario.md) | Perfis e matriz de permissões |
| 3 | [Regras de negócio](03-regras-negocio.md) | Regras RN01 a RN31 |
| 4 | [Casos de uso](04-casos-de-uso.md) | Casos de uso UC01 a UC18 |
| 5 | [Casos de teste](05-casos-de-teste.md) | Estratégia, CT01 a CT46, E2E e rastreabilidade |
| 6 | [Modelo de dados](06-modelo-dados.md) | Tabelas, restrições e diagrama ER |
| 7 | [API](07-api.md) | Rotas, convenções e códigos de erro |
| 8 | [Arquitetura](08-arquitetura.md) | Componentes, fluxos críticos, segurança, CI, deploy e decisões |

## Como os documentos se relacionam

Os identificadores conectam os documentos: cada caso de uso (UC) aplica regras (RN) e é verificado por casos de teste (CT). Ao mudar uma regra, atualize o caso de uso, os testes e a API correspondentes.

## Pontos a revisar

O engenheiro responsável aprovou as decisões principais durante a Fase 0. Os pontos abaixo foram **definidos ao escrever os documentos**, para fechar lacunas. Os marcados como "A revisar" ainda precisam de revisão, e os marcados como "Resolvido" foram aprovados na fase indicada ou, sem indicação, na Fase 2.

| Ponto | Definição adotada | Onde | Situação |
|---|---|---|---|
| Valores do passo da grade | 5, 10, 15, 20, 30 ou 60 minutos | RN01 | A revisar |
| Alinhamento da grade | Múltiplos do passo contados da meia-noite local | RN02 | A revisar |
| Horário local ambíguo em mudança de fuso | Usa a primeira ocorrência; horário inexistente é descartado | RN06 | A revisar |
| Status finais | `cancelled`, `completed` e `no_show` não mudam mais | RN15 | A revisar |
| Validade do link do cliente | Até 30 dias depois do início do atendimento | RN16 | A revisar |
| Remarcação | Mantém o serviço, e o profissional pode mudar | RN18 | A revisar |
| Agendamento pela equipe | Exige expediente, não exige grade e não aceita horário passado | RN19 | A revisar |
| Validade de tokens | Convite: 7 dias; recuperação de senha: 1 hora; refresh: 7 dias sem uso e 30 dias desde o login | RN24, RN31, Arquitetura | Resolvido na Fase 3 |
| Política de senha | De 12 a 128 caracteres, sem regras de composição | RN30 | Resolvido na Fase 3 |
| Revogação do token de acesso | A família do `sid` é conferida a cada requisição | Arquitetura | Resolvido na Fase 3 |
| Nascimento do profissional convidado | No convite, com `is_bookable = false`; o aceite liga as reservas | RN24, Modelo de dados | Resolvido na Fase 3 |
| Renovação de convite pendente | Convidar de novo no mesmo negócio troca o link | RN24, UC04 | Resolvido na Fase 3 |
| E-mails de conta acima do limite | Mesmos contadores; recuperação responde `202`, e convite responde `429` sem criar nada | RN26 | Resolvido na Fase 3 |
| Troca de senha com usuário logado | Fora da V1; a nova senha passa pela recuperação | UC03 | Resolvido na Fase 3 |
| Renovação entre abas | Precisa ser única, sob pena de revogar a família; obrigatório na fase do frontend | UC02, Arquitetura | Pendente para o frontend |
| Restante do UC04 | `POST /professionals/me`, `POST /professionals/{id}/deactivate`, com RN23 e CT18, e `GET /professionals` foram implementados | UC04, API | Resolvido na Fase 4 |
| Formatos da configuração | Expediente em `intervals`, com `weekday`, `start_time` e `end_time`; `conflicts` e `appointments_outside_hours` no mesmo formato, sem contato do cliente; instantes em UTC; listas simples, sem paginação nem filtros | UC08, UC09, API | Resolvido na Fase 4 |
| Intervalos encostados | Aceitos e guardados como enviados, sem juntar; um atendimento não atravessa a divisa entre eles | RN03, UC08, API | Resolvido na Fase 4 |
| Exclusão de serviço | Não há `DELETE`; todo serviço é apenas desativado por `PATCH` | UC06, API | Resolvido na Fase 4 |
| Desativação de profissional | Definitiva na V1: sem rota para reativar, e o e-mail continua em uso; só o Dono volta a atender | RN23, RN24, UC04, API | Resolvido na Fase 4 |
| Troca de fuso | Aceita; a resposta de `PATCH /business` lista os agendamentos futuros confirmados que ficaram fora do expediente no novo fuso | RN22, UC05, CT25, API | Resolvido na Fase 4 |
| `POST /professionals/me` repetido | `200` com o registro existente e `is_bookable = true`, sem código de erro novo | UC04, API | Resolvido na Fase 4 |
| Serviços de um profissional | Lidos em `service_ids`, de `GET /professionals`; serviço de outro negócio responde `404`, e serviço inativo é aceito | RN07, UC07, API | Resolvido na Fase 4 |
| Agendamentos que contam em cada regra | RN21: não cancelados, até `blocked_until`. RN22 e RN23: confirmados, com início no futuro; atendimento em andamento não conta. RN22 também considera o preparo | RN21, RN22, RN23, CT17 | Resolvido na Fase 4 |
| Campos travados na demo | Recusados só quando o valor muda; reenviar o mesmo valor é aceito | RN28, CT32 | Resolvido na Fase 4 |
| Limites máximos da configuração | Faixas na API, além dos mínimos do modelo de dados; antecedência mínima não supera a máxima | RN05, UC05, UC06, API | Resolvido na Fase 4 |
| Bloqueio no passado | Aceito, sem regra de data; o conflito com agendamentos vale normalmente | RN21, UC09, API | Resolvido na Fase 4 |
| `EMAIL_IN_USE` no cadastro e no convite | Revela que o e-mail existe; aceito, com limites por IP e por negócio | API | A revisar |
| Restrições da demo | Nome do negócio, `slug` e nome dos serviços travados; criação de serviços recusada; convites e recuperação de senha desligados | RN28 | A revisar |
| Conteúdo dos e-mails | Sem texto livre digitado pelo cliente | RN25 | A revisar |
| Valores dos limites de taxa | Valores iniciais na tabela da Arquitetura; os de login por IP, cadastro, redefinição, aceite e convites foram aprovados na Fase 3 | Arquitetura | A revisar |
| Reenvio com `Idempotency-Key` | Devolve o agendamento sem o link, que fica disponível apenas por e-mail; se o limite de e-mail impediu o envio na criação, gera um novo link e invalida o anterior | RN13, RN26 | A revisar |
| Casos de teste CT23 a CT36 | Acrescentados para cobrir decisões posteriores à aprovação de CT01 a CT22 | Casos de teste | A revisar |
| `business_id` em `working_hours` e `time_blocks` | Acrescentado para aplicar as chaves compostas aprovadas | Modelo de dados | A revisar |
| CHECKs além das regras de negócio | Valores numéricos válidos, token de acesso e campos de idempotência coerentes, e `payload` da outbox coerente com o status | Modelo de dados | Resolvido |
| Índices adicionais | `refresh_tokens (user_id)`, `account_tokens (user_id)` e `professional_services (service_id)` | Modelo de dados | Resolvido |
| Valores sem padrão definido | `timezone` sem padrão, `is_bookable` com padrão `true` e `time_blocks.reason` obrigatório | Modelo de dados | Resolvido |
| Exclusão com chaves estrangeiras | `ON DELETE RESTRICT` em todas as chaves | Modelo de dados, Arquitetura | Resolvido |
