# 8. Arquitetura

## Visão geral

```mermaid
flowchart LR
    B["Navegador"] --> F["Frontend React<br/>arquivos estáticos"]
    B -->|"/api/v1"| A["API FastAPI"]
    A --> D[("PostgreSQL")]
    W["Worker de e-mail"] --> D
    W --> E["Resend"]
    J["Restauração noturna<br/>da demo"] --> D
```

| Componente | Responsabilidade |
|---|---|
| Frontend | SPA com a página pública e o painel da equipe |
| API | Autenticação, regras de negócio e persistência |
| PostgreSQL | Dados, garantias de integridade, fila de e-mails e contadores de limite |
| Worker | Envia os e-mails pendentes, com retentativas |
| Restauração da demo | Tarefa agendada que recria os dados do negócio demo, apagando os dependentes antes, porque as chaves estrangeiras usam `ON DELETE RESTRICT` |

## Estrutura do repositório

```text
agenda-inteligente/
├── backend/
│   ├── app/
│   │   ├── api/           # Rotas, dependências e tratamento de erros
│   │   ├── services/      # Casos de uso e transações
│   │   ├── domain/        # Regras puras, como a disponibilidade
│   │   ├── repositories/  # Acesso a dados, sempre com business_id
│   │   ├── models/        # Modelos SQLAlchemy
│   │   ├── schemas/       # Modelos Pydantic
│   │   ├── core/          # Configuração e segurança
│   │   ├── email/         # Interface, adaptadores e modelos
│   │   └── jobs/          # Worker e restauração da demo
│   ├── alembic/
│   └── tests/
├── frontend/
│   ├── src/
│   └── e2e/
├── docs/
├── docker-compose.yml
└── .github/workflows/
```

A documentação é escrita em português, e o código, em inglês.

## Backend

As camadas seguem `api → services → repositories`:

- **`api`** valida a entrada, resolve a sessão e traduz erros para HTTP.
- **`services`** coordena cada caso de uso e controla a transação.
- **`domain`** contém regras puras, sem acesso ao banco e com o tempo recebido como parâmetro.
- **`repositories`** encapsula as consultas e exige `business_id` nas operações de tenant.

**Tecnologias:** FastAPI, SQLAlchemy 2 assíncrono, Alembic, Pydantic v2 e uv. As versões serão fixadas na Fase 1.

### Cálculo de disponibilidade

Uma função pura recebe a configuração, os intervalos de expediente, os períodos ocupados, a duração e o instante atual, e devolve os horários livres. O serviço apenas carrega esses dados do banco e chama a função, o que permite testar todas as regras e mudanças de fuso sem banco.

## Frontend

Vite, React, TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query, React Hook Form e Zod. Os tipos da API são gerados a partir do OpenAPI.

O token de acesso fica somente em memória. Ao recarregar a página, o frontend chama `/auth/refresh`.

**A renovação precisa ser única entre abas.** O refresh tem rotação sem tolerância: duas chamadas simultâneas com o mesmo cookie, como ao recarregar duas abas, são tratadas como reuso e revogam a família, o que encerra a sessão. A fase do frontend deve serializar `/auth/refresh` entre abas, por exemplo com a Web Locks API, e reler o resultado obtido pela aba que renovou. Esse requisito é obrigatório para a fase do frontend, porque a API não consegue distinguir essa corrida de um roubo de token.

## Fluxos críticos

### Criar agendamento

```mermaid
sequenceDiagram
    actor C as Cliente
    participant A as API
    participant D as PostgreSQL
    participant W as Worker
    participant E as Resend

    C->>A: POST com Idempotency-Key
    A->>D: Confere limites e idempotência
    A->>D: BEGIN e trava profissionais em ordem de id
    A->>D: Verifica disponibilidade e escolhe o profissional
    A->>D: INSERT em appointments e email_outbox
    A->>D: COMMIT
    A-->>C: 201 com o link
    W->>D: Busca pendentes com FOR UPDATE SKIP LOCKED
    W->>E: Envia o e-mail
    W->>D: Na mesma escrita, marca como enviado e apaga o payload
```

Falhas possíveis:

- **Conflito concorrente:** o travamento e a restrição `EXCLUDE` garantem um único vencedor, e o outro recebe `409`.
- **Corrida de idempotência:** o índice único também trata duas requisições simultâneas com a mesma chave.
- **Provedor fora do ar:** o agendamento já foi confirmado, e o worker tenta de novo mais tarde.

### Envio de e-mails

O padrão outbox grava o e-mail na mesma transação da operação, então nenhum e-mail se perde nem é enviado por uma operação desfeita.

- São até 5 tentativas com espera crescente. Depois disso, a mensagem fica como `failed`, com `last_error`.
- O worker apaga o `payload` na mesma escrita que muda o status para `sent` ou para `failed`, porque ele pode conter um token bruto. Uma restrição `CHECK` no banco recusa a escrita que não fizer isso.
- O envio é "pelo menos uma vez". O `id` da mensagem é usado como chave de idempotência, quando o provedor oferece esse recurso.
- `FOR UPDATE SKIP LOCKED` permite vários workers, sem Redis.
- O provedor é o Resend, atrás de uma interface que permite trocá-lo. Os testes usam um adaptador falso.

## Segurança

### Autenticação

- **Senhas:** hash com Argon2id, com 64 MiB, 3 passadas e paralelismo 4. O login verifica um hash fictício quando a conta não tem senha, para que o tempo não revele se ela existe.
- **Token de acesso:** JWT HS256 de 15 minutos, mantido em memória. Contém `sub`, `sid` (a família do refresh), `iss`, `iat` e `exp`, sem `business_id`.
- **Refresh:** token opaco, com rotação, guardado como hash e entregue em cookie `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/api/v1/auth`. Expira depois de 7 dias sem uso e, em qualquer caso, 30 dias depois do login ([RN31](03-regras-negocio.md#contas-e-demo)). O reuso revoga a família inteira. O `Secure` não tem opção de desligar; em desenvolvimento, Chrome e Firefox o aceitam em `localhost`.
- **Revogação imediata:** a dependência de autenticação carrega o usuário a cada requisição, confere `is_active` e exige que a família do `sid` não esteja revogada. Assim, desativação, logout, redefinição de senha e reuso de refresh valem na hora, sem esperar o token de acesso expirar.
- **Concorrência:** todo fluxo de sessão ou credencial trava primeiro o usuário e depois seus tokens. Duas operações do mesmo usuário ficam em série, sem deadlock, e nenhuma sessão sobrevive a uma redefinição simultânea.
- **CSRF:** `SameSite=Strict`, cabeçalho `X-Requested-With` nas rotas com cookie e lista fixa de origens em CORS.
- **Segredos:** `JWT_SECRET` e `RATE_LIMIT_KEY_SECRET` precisam ter ao menos 32 caracteres, ou a aplicação não sobe.

### Isolamento entre negócios

1. O negócio vem da sessão, nunca de um parâmetro.
2. Os repositórios exigem `business_id`.
3. As chaves estrangeiras compostas impedem relações entre negócios.
4. O CT19 testa o acesso cruzado em todas as rotas.

RLS não é usado na V1. É uma defesa adicional possível, mas exigiria `SET LOCAL` por transação e exceções para rotas públicas, worker e migrações.

### Proteção contra abuso

Os limites usam contadores no PostgreSQL, com janelas fixas, e valem entre processos. Cada tentativa é contada em transação própria, para que o rollback de um login falho não apague a contagem. Os limites de e-mail são a exceção: ficam na transação da operação, porque uma operação desfeita não envia nada.

O IP vem apenas do cabeçalho definido em `TRUSTED_CLIENT_IP_HEADER`, usando o valor mais à direita da lista, que é o acrescentado pelo proxy mais próximo. Sem essa variável, vale o endereço da conexão, e cabeçalhos enviados pelo cliente são ignorados. Valores iniciais, a ajustar com o uso:

| Alvo | Limite |
|---|---|
| Criar agendamento público | 10 por hora, por IP |
| Consultar disponibilidade | 120 por minuto, por IP |
| Rotas com token de cliente | 60 por minuto, por IP |
| Login | 10 por 15 minutos, por combinação de IP e e-mail |
| Login | 50 por 15 minutos, por IP |
| Cadastro de negócio | 5 por hora, por IP |
| Recuperação de senha | 5 por hora, por IP |
| Redefinição de senha e aceite de convite | 10 por hora, por IP, em um único contador |
| Convites | 20 por hora, por negócio |
| E-mails por destinatário | 3 por dia UTC |
| E-mails no total | 100 por dia UTC, a ajustar conforme o plano do provedor |

Refresh e logout não têm limite: o token não é adivinhável, e um `429` em rede compartilhada encerraria sessões legítimas.

O cadastro fechado e as restrições da [RN28](03-regras-negocio.md#contas-e-demo) impedem que a demo envie conteúdo livre a terceiros.

### Dados pessoais

A demo guarda apenas nome, e-mail e telefone do agendamento, e a restauração noturna os apaga. Logs nunca incluem tokens, senhas nem dados de contato. A consulta pelo link não devolve e-mail nem telefone. Esses cuidados não equivalem à operação exigida para clientes reais, que está fora do escopo.

## Ambiente local

O `docker-compose.yml` sobe `db`, `api`, `worker` e `frontend`. Em desenvolvimento, o e-mail usa um adaptador que apenas registra a mensagem no log. Os segredos ficam em variáveis de ambiente, e o repositório inclui somente um `.env.example`.

Variáveis principais:

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão com o banco |
| `JWT_SECRET` | Assinatura do token de acesso, com ao menos 32 caracteres |
| `RATE_LIMIT_KEY_SECRET` | HMAC dos contadores de limite, com ao menos 32 caracteres |
| `RESEND_API_KEY` | Envio de e-mails |
| `EMAIL_BACKEND` | `console`, `fake` ou `resend` |
| `EMAIL_DAILY_CAP`, `EMAIL_RECIPIENT_DAILY_CAP` | Limites de envio |
| `REGISTRATION_ENABLED` | Liga o cadastro de negócios |
| `CORS_ALLOWED_ORIGINS` | Origens permitidas, separadas por vírgula |
| `FRONTEND_BASE_URL` | Base dos links enviados por e-mail |
| `TRUSTED_CLIENT_IP_HEADER` | Cabeçalho com o IP do cliente, definido pelo proxy da hospedagem; vazio sem proxy |

## CI (GitHub Actions)

Em cada pull request:

1. **Backend:** Ruff e mypy.
2. **Testes do backend:** pytest com PostgreSQL e os limites de cobertura de 90% e 80%.
3. **Migrações:** aplica do zero e confere se os modelos estão sincronizados com elas.
4. **Frontend:** ESLint, `tsc` e Vitest.
5. **Ponta a ponta:** Playwright nos fluxos E2E01 e E2E02.
6. **Imagens:** build das imagens Docker.

## Deploy

- **API, worker e banco:** PaaS, como Render ou Railway.
- **Frontend:** hospedagem estática, como Cloudflare Pages ou Vercel.
- **Migrações:** executadas uma vez antes de cada nova versão da API.
- **Restauração da demo:** tarefa agendada da plataforma, que executa `app/jobs`.

A escolha final e os preços serão confirmados antes do deploy, porque os planos gratuitos mudam e podem hibernar serviços ou não oferecer tarefas agendadas.

**Domínio próprio obrigatório:** frontend e API devem ficar em subdomínios do mesmo domínio, como `app.exemplo.com` e `api.exemplo.com`. Domínios padrão de PaaS costumam ser sites diferentes para o navegador, o que impediria o cookie `SameSite=Strict`. O mesmo domínio serve para autenticar o envio de e-mails com SPF e DKIM.

## Registro de decisões

| Tema | Decisão | Motivo principal | Alternativa rejeitada |
|---|---|---|---|
| Modelo | SaaS multi-negócio | Mostra arquitetura com isolamento | Negócio único, marketplace |
| Isolamento | Filtro nos repositórios e chaves compostas | Simples de entender e depurar | RLS, por complexidade |
| Conflitos | `EXCLUDE` e travamento do profissional | Garantia no banco, inclusive entre tabelas | Verificação apenas na aplicação |
| Duplicidade | `Idempotency-Key` | Cobre retentativas de rede e "sem preferência" | Apenas bloquear o botão |
| Cliente | Dados no agendamento | E-mail não verificado não deve associar pessoas | Tabela `customers` |
| Histórico | Apenas campos de data | Nenhum caso de uso consome eventos | Tabela de eventos |
| Quem atende | Tabela `professionals` | Separa login de agenda | Campo em `users` |
| Enums | `text` com `CHECK` e `StrEnum` no código | Acrescentar um valor exige apenas trocar o `CHECK` | Tipos nativos do PostgreSQL |
| Exclusões | `ON DELETE RESTRICT` em todas as chaves estrangeiras | Serviços e contas são desativados, e nada some em cascata por engano | `CASCADE` |
| Autenticação | JWT curto e refresh em cookie | Revogável e sem token acessível a scripts | Sessão opaca, `localStorage` |
| Revogação do JWT | Conferir a família do `sid` a cada requisição | Logout e redefinição valem na hora, com uma consulta indexada e sem schema novo | Esperar até 15 minutos pela expiração |
| Validade do refresh | 7 dias sem uso e 30 dias desde o login | Sessão ativa não precisa de novo login a cada semana, mas não dura para sempre | Validade fixa, rotação que estende sem limite |
| E-mail | Outbox e worker próprio | Não perde mensagens e não exige Redis | `BackgroundTasks`, Celery |
| Limites | Contadores no PostgreSQL | Valem entre processos, sem novo serviço | Memória, Redis |
| Demo | Cadastro fechado, e-mail com limites e restauração noturna | Reduz abuso e mantém dados atuais | Cadastro aberto, botão de reset |
| Hospedagem | PaaS e frontend estático | Pouca operação | VPS com Docker Compose |
| Testes | PostgreSQL real e Playwright nos fluxos críticos | Testa as garantias reais com CI rápido | SQLite, E2E em todos os fluxos |
