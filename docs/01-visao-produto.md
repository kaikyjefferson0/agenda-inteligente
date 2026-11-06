# 1. Visão do produto

## Resumo

O Agenda Inteligente é um SaaS multi-negócio de agendamento online. Cada negócio tem seus dados isolados e uma página pública onde clientes reservam horários sem criar conta.

## Problema

Negócios de beleza e bem-estar costumam marcar horários por telefone e mensagens. Isso ocupa a equipe durante o atendimento e favorece erros. Os serviços têm durações diferentes, cada profissional tem seu expediente, e calcular manualmente o que está livre fica difícil.

## Público-alvo

Barbearias, salões e estúdios com um ou mais profissionais.

Saúde fica fora do foco porque exige tratamento de dados sensíveis, prontuário e convênios.

## Proposta de valor

- **Para o cliente:** ver apenas horários realmente livres e reservar em poucos passos, sem cadastro.
- **Para o negócio:** agenda sempre coerente, sem sobreposição, com regras próprias de antecedência e alteração.

## O que é "inteligente" na V1

A inteligência da V1 é determinística, sem modelos de IA:

1. **Disponibilidade automática:** combina expediente, duração do serviço, tempo de preparo, bloqueios, agendamentos e antecedência.
2. **Atribuição em "sem preferência":** escolhe o profissional apto e livre com menos agendamentos no dia.

## Objetivos como portfólio

O projeto deve demonstrar:

- Regras de domínio não triviais, testadas de forma isolada.
- Garantia de nenhum conflito no banco, mesmo com requisições concorrentes.
- Isolamento entre negócios e controle de acesso por papel.
- Entrega confiável de e-mails com o padrão outbox.
- Engenharia completa: testes, CI, contêineres e deploy público.

## Escopo da V1

**Inclui:**

- Cadastro de negócio, autenticação, convite de profissionais e recuperação de senha.
- Configuração de negócio, serviços, expediente e bloqueios.
- Página pública com disponibilidade e agendamento.
- Consulta, cancelamento e remarcação por link seguro.
- Agenda da equipe, agendamento manual e registro do resultado do atendimento.
- E-mails reais, com limites de envio.
- Demo pública com login de demonstração e dados restaurados toda noite.

**Não inclui:**

- Lembretes automáticos, lista de espera e sugestões com IA.
- Pagamentos e múltiplas moedas (preços apenas em BRL).
- Marketplace, busca entre negócios e avaliações.
- Vários serviços em um único agendamento.
- Contas de cliente e histórico por cliente.
- Perfil de recepção e administrador da plataforma.
- Uso com clientes reais, incluindo a operação exigida para isso (conformidade completa com a LGPD, suporte e monitoramento de produção).

## Entrega

Deploy público com um negócio de demonstração, para que uma pessoa avaliadora possa testar o produto sem instalar nada. O cadastro de novos negócios é implementado e testado, mas fica desligado na demo pública ([RN27](03-regras-negocio.md#contas-e-demo)).

## Critérios de sucesso

- Uma pessoa avaliadora consegue fazer um agendamento na demo e entrar como Dono ou Profissional, sem ajuda.
- O teste de concorrência (CT06) comprova que apenas uma de duas reservas simultâneas é aceita.
- O CI bloqueia merges abaixo de 90% de cobertura nas regras de agendamento e 80% no restante do backend.
- Todo o ambiente sobe localmente com Docker Compose.
