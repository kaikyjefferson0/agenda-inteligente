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
| Valores do passo da grade | 5, 10, 15, 20, 30 ou 60 minutos | RN01 | Resolvido na etapa de agendamento público |
| Alinhamento da grade | Múltiplos do passo contados da meia-noite local | RN02 | Resolvido na etapa de agendamento público |
| Horário local ambíguo em mudança de fuso | Usa a primeira ocorrência; horário inexistente é descartado. Os testes de mudança de fuso usam `America/New_York` | RN06, CT05 | Resolvido na etapa de agendamento público |
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
| Valores dos limites de taxa | Os valores da tabela da Arquitetura | Arquitetura | Resolvido na etapa de agendamento público |
| Reenvio com `Idempotency-Key` | Devolve o agendamento sem o link, que fica disponível apenas por e-mail; se o limite de e-mail impediu o envio na criação, gera um novo link e invalida o anterior | RN13, RN26 | Resolvido na etapa de agendamento público |
| D1. Formatos da página pública e da disponibilidade | `GET /public/businesses/{slug}` e `availability` nos formatos da API, sem e-mail, preparo nem o profissional de cada horário; instantes com o deslocamento do fuso do negócio | UC10, API | A revisar |
| D2. Horário fora da grade na reserva pública | `422 VALIDATION_ERROR` em `starts_at`, inclusive a segunda ocorrência de um horário ambíguo. A lista de `SLOT_UNAVAILABLE` não muda: fora da antecedência, ocupado ou fora do expediente seguem como `409` | RN02, RN06, UC11, API | A revisar |
| D3. Serviço inativo nas rotas públicas | `404`, igual a inexistente, porque o lado público só conhece serviços ativos | RN07, UC10, UC11, API | A revisar |
| D4. Profissional nas rotas públicas | Inexistente ou de outro negócio: `404`. Sem o serviço ou com `is_bookable = false`: `422`, na disponibilidade e na reserva | RN07, UC10, UC11, CT08, API | A revisar |
| D5. Limite da página pública | A tabela era omissa; a rota tem contador próprio de 120 por minuto por IP | Arquitetura, API | A revisar |
| D6. O que conta nos limites públicos | Toda requisição, inclusive repetições, `404` e `422`. A exceção é JSON malformado, recusado pelo framework antes da contagem e sem acessar o banco | CT22, Arquitetura | A revisar |
| D7. Formato da `Idempotency-Key` | UUID com hifens, de qualquer versão; ausente ou inválida responde `422`; maiúsculas e minúsculas contam como a mesma chave | RN13, API | A revisar |
| D8. Dados do fingerprint | Serviço, profissional, instante com o deslocamento enviado, nome, e-mail e telefone, depois de validados. O mesmo instante com outro deslocamento e o e-mail com outra caixa contam como dados diferentes e são recusados | RN13, CT24 | A revisar |
| D9. Validação do cliente | Nome de 1 a 120 caracteres, sem caracteres de controle; e-mail validado; telefone em E.164, com o frontend convertendo o que for digitado | RN12, UC11, API | A revisar |
| D10. Conteúdo do e-mail de criação | Link, negócio, serviço, profissional e horário local, sem o nome do cliente | RN25 | A revisar |
| D11. Troca do link em repetição | Ocorre sempre que `link_email_skipped = true`, a cada repetição e em qualquer status, como na RN13; a marca não volta a `false` | RN13, RN26, CT36 | A revisar |
| D12. "Cadastro mais antigo" | `professionals.created_at` | RN10, CT07 | A revisar |
| D13. Antecedência máxima | `agora + N × 24 horas` exatas, como na fórmula da RN05 | RN05, CT04 | A revisar |
| D14. Aptos sem horários | Profissional apto sem expediente aparece e não tem horários; serviço ativo sem profissional aparece e não tem horários | RN07, UC10 | A revisar |
| D15. Reservas no negócio demo | Funcionam normalmente, com os limites de e-mail, porque a RN28 não as restringe | RN26, RN28 | A revisar |
| D16. Bloco na hora repetida | O bloco inteiro precisa ficar no intervalo, minuto a minuto, e não só nas pontas: sai se passar do fim do intervalo e volta, e cabe se terminar no instante em que o relógio volta ao início dele. Vale também para a lista da RN22 | RN03, RN06, RN22, CT05 | A revisar |
| Caractere nulo em texto | Recusado com `422` em `Name` e no motivo do bloqueio, porque o PostgreSQL não o aceita; `slug` com esse caractere responde `404` | API | A revisar |
| Parte do CT10 e do CT36 sem rota | A parte "ao remarcar" do CT10 e o `404` do link anterior no CT36 dependem das rotas do link do cliente. Até lá, o CT36 confere o hash guardado | CT10, CT36 | Pendente para a Parte B |
| Casos de teste CT23 a CT36 | Acrescentados para cobrir decisões posteriores à aprovação de CT01 a CT22 | Casos de teste | A revisar |
| `business_id` em `working_hours` e `time_blocks` | Acrescentado para aplicar as chaves compostas aprovadas | Modelo de dados | A revisar |
| Tipos de campos opcionais sem `null` nos schemas de `PATCH` | `cast` no default, lidos com `model_dump(exclude_unset=True)` | API | A revisar |
| CHECKs além das regras de negócio | Valores numéricos válidos, token de acesso e campos de idempotência coerentes, e `payload` da outbox coerente com o status | Modelo de dados | Resolvido |
| Índices adicionais | `refresh_tokens (user_id)`, `account_tokens (user_id)` e `professional_services (service_id)` | Modelo de dados | Resolvido |
| Valores sem padrão definido | `timezone` sem padrão, `is_bookable` com padrão `true` e `time_blocks.reason` obrigatório | Modelo de dados | Resolvido |
| Exclusão com chaves estrangeiras | `ON DELETE RESTRICT` em todas as chaves | Modelo de dados, Arquitetura | Resolvido |
