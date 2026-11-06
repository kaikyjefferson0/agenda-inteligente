# Agenda Inteligente

Sistema de agendamento online para negócios de beleza e bem-estar. Projeto de portfólio full stack, com a documentação em [`docs/`](docs/README.md).

**Estado atual:** Fase 1, apenas a estrutura do projeto. Ainda não há regras de negócio.

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

## Comandos úteis

Com os containers no ar:

```bash
# Backend
docker compose exec api pytest
docker compose exec api ruff check .
docker compose exec api ruff format --check .
docker compose exec api alembic current

# Frontend
docker compose exec frontend npm run lint
docker compose exec frontend npm run build
```

Os testes do backend usam o PostgreSQL real do Compose e, por isso, rodam no container.

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
