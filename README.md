# Agenda Inteligente

Sistema de agendamento online para negócios de beleza e bem-estar. Projeto de portfólio full stack, com a documentação em [`docs/`](docs/README.md).

**Estado atual:** Fase 2, com a estrutura do projeto e o modelo de dados: 12 tabelas e a primeira migração. Ainda não há rotas de domínio nem regras de negócio na aplicação.

## Pré-requisitos

- Docker com Docker Compose

Para rodar comandos fora dos containers, também são necessários [uv](https://docs.astral.sh/uv/) e Node 24.

## Como rodar

```bash
cp .env.example .env
docker compose up --build
```

| Serviço | Endereço |
|---|---|
| Frontend | <http://localhost:5173> |
| API | <http://localhost:8000> |
| Documentação da API | <http://localhost:8000/docs> |
| Verificação da API e do banco | <http://localhost:8000/health> |
| PostgreSQL | `localhost:5433` |

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

# Frontend
docker compose exec frontend npm run lint
docker compose exec frontend npm run build
```

## Estrutura

```text
backend/    API FastAPI, gerenciada com uv
frontend/   SPA com Vite, React, TypeScript, Tailwind e shadcn/ui
docs/       Documentação do produto e da arquitetura
```

A arquitetura está descrita em [`docs/08-arquitetura.md`](docs/08-arquitetura.md). O serviço `worker` será adicionado ao Compose quando existir o envio de e-mails.

## Versões

| Ferramenta | Versão |
|---|---|
| Python | 3.14 |
| uv | 0.13.7 |
| FastAPI | 0.162.0 |
| SQLAlchemy | 2.1.8 |
| Alembic | 1.20.1 |
| Pydantic | 2.14.3 |
| Node | 24 |
| React | 19.3.1 |
| Vite | 8.3.6 |
| TypeScript | 6.0.3 |
| Tailwind CSS | 4.3.4 |
| PostgreSQL | 18.6 |

O TypeScript fica na 6.0 porque o `typescript-eslint` 8.72.1 ainda não aceita a 7.
