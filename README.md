# Agenda Inteligente

Sistema de agendamento online para negócios de beleza e bem-estar. Projeto de portfólio full stack, com a documentação em [`docs/`](docs/README.md).

**Estado atual:** o backend está completo. Ele cobre:

- **Autenticação:** cadastro do negócio e do Dono, login, logout, renovação de sessão, convite de profissional e recuperação de senha.
- **Configuração:** definições do negócio, serviços, equipe, serviços de cada profissional, expediente semanal e bloqueios.
- **Agendamento público:** página do negócio, disponibilidade e reserva, com idempotência e limites por IP.
- **Link do cliente:** consulta, cancelamento e remarcação.
- **Agenda da equipe:** agenda, agendamento manual, remarcação, cancelamento e resultado do atendimento.
- **Envio de e-mails:** worker com retentativas, Mailpit no desenvolvimento e Resend em produção.
- **Restauração da demo:** tarefa que recria o negócio de demonstração com datas atuais.

O frontend é a próxima etapa. O projeto tem CI no GitHub Actions, que roda em todo pull request para a `main`.

## Pré-requisitos

- Docker com Docker Compose

Para rodar comandos fora dos containers, também são necessários [uv](https://docs.astral.sh/uv/) e Node 24.

## Como rodar

```bash
cp .env.example .env
docker compose up --build
```

A API não sobe se `JWT_SECRET` ou `RATE_LIMIT_KEY_SECRET` tiverem menos de 32 caracteres. Se o seu `.env` for anterior à autenticação, troque esses dois valores, por exemplo com `openssl rand -hex 32`, e recrie o container da API. Se ele for anterior ao worker de e-mails, troque `EMAIL_BACKEND=console` por `EMAIL_BACKEND=smtp`, porque o `console` não existe mais.

| Serviço | Endereço |
|---|---|
| Frontend | <http://localhost:5173> |
| API | <http://localhost:8000> |
| Documentação da API | <http://localhost:8000/docs> |
| Verificação da API e do banco | <http://localhost:8000/health> |
| PostgreSQL | `localhost:5433` |
| E-mails enviados (Mailpit) | <http://localhost:8025> |

O PostgreSQL usa a porta 5433 no host para não conflitar com uma instalação local na 5432.

O código é montado nos containers, e as alterações recarregam sozinhas. Depois de mudar as dependências do frontend, recrie o volume de `node_modules`:

```bash
docker compose up --build --renew-anon-volumes
```

## Modelo de dados e migrações

Os modelos SQLAlchemy ficam em `backend/app/models/`, e as migrações, em `backend/alembic/versions/`. As tabelas e restrições estão descritas em [`docs/06-modelo-dados.md`](docs/06-modelo-dados.md).

As migrações não rodam sozinhas. Com os containers no ar, aplique-as depois de subir o projeto pela primeira vez e sempre que houver uma nova:

```bash
docker compose exec api alembic upgrade head
```

Para conferir a revisão aplicada e se os modelos estão sincronizados com as migrações:

```bash
docker compose exec api alembic current
docker compose exec api alembic check
```

## Demo

Com as migrações aplicadas, crie ou restaure o negócio de demonstração:

```bash
docker compose run --rm api python -m app.jobs.restore_demo
```

A tarefa apaga e recria apenas o negócio demo, com agendamentos nos 7 dias anteriores e nos próximos, e pode ser repetida. Ela exige `DEMO_PASSWORD` no `.env`, de 12 a 128 caracteres; se o seu `.env` for anterior à demo, copie a linha do `.env.example`. Ao terminar, a página pública fica em <http://localhost:8000/api/v1/public/businesses/barbearia-demo>, e as duas contas entram com essa senha:

| Conta | Perfil |
|---|---|
| `dono@demo.example.com` | Dono, que também atende |
| `profissional@demo.example.com` | Profissional |

Cada restauração encerra as sessões abertas nessas contas.

## Testes

```bash
docker compose exec api pytest
```

Os testes do backend usam o PostgreSQL real do Compose e, por isso, rodam no container. Os testes de migração e de restrições criam os bancos `agenda_test` e `agenda_migrations_test`, recriados a cada execução, então o banco de desenvolvimento não é alterado e não precisa estar migrado.

## Comandos úteis

Com os containers no ar:

```bash
# Backend
docker compose exec api ruff check .
docker compose exec api ruff format --check .
docker compose exec api mypy

# Testes do backend com cobertura: mínimo de 80% no geral e de 90% em app/domain
docker compose exec api pytest --cov --cov-report=term-missing --cov-fail-under=80
docker compose exec api coverage report --include="app/domain/*" --fail-under=90

# Frontend
docker compose exec frontend npm run lint
docker compose exec frontend npm run build
```

O `coverage report` usa os dados gravados pelo `pytest --cov`, então rode-o depois dele.

## Estrutura

```text
backend/    API FastAPI, gerenciada com uv
frontend/   SPA com Vite, React, TypeScript, Tailwind e shadcn/ui
docs/       Documentação do produto e da arquitetura
```

A arquitetura está descrita em [`docs/08-arquitetura.md`](docs/08-arquitetura.md). O serviço `worker` envia os e-mails da fila; em desenvolvimento, eles chegam ao Mailpit. Ele não recarrega sozinho: depois de mudar o código do backend, rode `docker compose restart worker`.

## Versões

| Ferramenta | Versão |
|---|---|
| Python | 3.14 |
| uv | 0.13.7 |
| FastAPI | 0.162.0 |
| SQLAlchemy | 2.1.8 |
| Alembic | 1.20.1 |
| Pydantic | 2.14.3 |
| mypy | 2.3.1 |
| pytest-cov | 7.0.0 |
| Node | 24 |
| React | 19.3.1 |
| Vite | 8.3.6 |
| TypeScript | 6.0.3 |
| Tailwind CSS | 4.3.4 |
| PostgreSQL | 18.6 |

O TypeScript fica na 6.0 porque o `typescript-eslint` 8.72.1 ainda não aceita a 7.
