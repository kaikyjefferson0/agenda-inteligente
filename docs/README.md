# Agenda Inteligente: documentação (Fase 0)

Sistema de agendamento online para negócios de beleza e bem-estar. Projeto de portfólio full stack.

**Stack:** FastAPI com uv, PostgreSQL, React + TypeScript + Tailwind + shadcn/ui, Docker e GitHub Actions.

## Documentos

| # | Documento | Conteúdo |
|---|---|---|
| 1 | [Visão do produto](01-visao-produto.md) | Problema, público-alvo, escopo da V1 e critérios de sucesso |
| 2 | [Perfis de usuário](02-perfis-usuario.md) | Perfis e matriz de permissões |
| 3 | [Regras de negócio](03-regras-negocio.md) | Regras RN01 a RN29 |
| 4 | [Casos de uso](04-casos-de-uso.md) | Casos de uso UC01 a UC18 |
| 5 | [Casos de teste](05-casos-de-teste.md) | Estratégia, CT01 a CT36, E2E e rastreabilidade |
| 6 | [Modelo de dados](06-modelo-dados.md) | Tabelas, restrições e diagrama ER |
| 7 | [API](07-api.md) | Rotas, convenções e códigos de erro |
| 8 | [Arquitetura](08-arquitetura.md) | Componentes, fluxos críticos, segurança, CI, deploy e decisões |

## Como os documentos se relacionam

Os identificadores conectam os documentos: cada caso de uso (UC) aplica regras (RN) e é verificado por casos de teste (CT). Ao mudar uma regra, atualize o caso de uso, os testes e a API correspondentes.

## Pontos a revisar

O engenheiro responsável aprovou as decisões principais durante a Fase 0. Os pontos abaixo foram **definidos ao escrever os documentos**, para fechar lacunas, e ainda precisam de revisão.

| Ponto | Definição adotada | Onde |
|---|---|---|
| Valores do passo da grade | 5, 10, 15, 20, 30 ou 60 minutos | RN01 |
| Alinhamento da grade | Múltiplos do passo contados da meia-noite local | RN02 |
| Horário local ambíguo em mudança de fuso | Usa a primeira ocorrência; horário inexistente é descartado | RN06 |
| Status finais | `cancelled`, `completed` e `no_show` não mudam mais | RN15 |
| Validade do link do cliente | Até 30 dias depois do início do atendimento | RN16 |
| Remarcação | Mantém o serviço, e o profissional pode mudar | RN18 |
| Agendamento pela equipe | Exige expediente, não exige grade e não aceita horário passado | RN19 |
| Validade de tokens | Convite: 7 dias; recuperação de senha: 1 hora; refresh: 14 dias | RN24, Arquitetura |
| Restrições da demo | Nome do negócio, `slug` e nome dos serviços travados; criação de serviços recusada; convites e recuperação de senha desligados | RN28 |
| Conteúdo dos e-mails | Sem texto livre digitado pelo cliente | RN25 |
| Valores dos limites de taxa | Valores iniciais na tabela da Arquitetura | Arquitetura |
| Reenvio com `Idempotency-Key` | Devolve o agendamento sem o link, que fica disponível apenas por e-mail; se o limite de e-mail impediu o envio na criação, gera um novo link e invalida o anterior | RN13, RN26 |
| Casos de teste CT23 a CT36 | Acrescentados para cobrir decisões posteriores à aprovação de CT01 a CT22 | Casos de teste |
| `business_id` em `working_hours` e `time_blocks` | Acrescentado para aplicar as chaves compostas aprovadas | Modelo de dados |
