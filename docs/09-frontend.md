# 9. Frontend

SPA com Vite, React, TypeScript, Tailwind CSS e shadcn/ui, na pasta `frontend/`. As decisões desta etapa são a D50 a D58 dos [Pontos a revisar](README.md#pontos-a-revisar).

## Estrutura de pastas

```text
frontend/src/
├── api/          # Cliente tipado, erros, mensagens, QueryClient e contrato da API
│   ├── openapi.json   # Exportado do backend (D51), versionado
│   └── schema.d.ts    # Gerado por npm run api:types (D51), versionado
├── app/          # Roteador e provedores (TanStack Query e tooltips)
├── components/
│   ├── ui/       # Componentes do shadcn, instalados com npx shadcn add (D58)
│   ├── layout/   # PublicLayout, PanelLayout, marca, link de pular e página provisória
│   ├── feedback/ # ErrorMessage, PageLoader e RouteError
│   └── marketing/# Seção principal da página inicial (Magic, D58)
├── features/     # Vazia nesta etapa: cada etapa seguinte cria a sua pasta
├── hooks/        # Hooks compartilhados, como o use-mobile do sidebar
├── lib/          # Funções puras: datas e fusos, esquema de cores e utilitários
├── pages/        # Páginas por grupo de rotas: public/, account/, panel/ e a 404
└── test/         # Configuração do Vitest e servidor do MSW com os handlers
```

Os testes ficam ao lado do código, como `datetime.test.ts`. As páginas ficam agrupadas por grupo de rotas, e não em uma lista plana, porque cada grupo é um módulo carregado sob demanda (D54). `features/` vai reunir, por funcionalidade, os componentes, consultas e formulários das próximas etapas; as páginas apenas os compõem.

## Rotas (D54)

| Rota | Página | Grupo |
|---|---|---|
| `/` | Apresentação do projeto, com links para a demo e para `/entrar` | Público |
| `/n/:slug` | Página pública do negócio | Público |
| `/agendamento/:token` | Link do cliente | Público |
| `/entrar` | Login | Conta |
| `/esqueci-senha` | Pedido de recuperação de senha | Conta |
| `/convite/:token` | Aceite de convite (link de `app/services/invitations.py`) | Conta |
| `/recuperar-senha/:token` | Nova senha (link de `app/services/passwords.py`) | Conta |
| `/painel` | Agenda | Painel |
| `/painel/servicos`, `/equipe`, `/expediente`, `/bloqueios`, `/negocio` | Configuração | Painel |
| Qualquer outra | Página não encontrada | Principal |

- Nesta etapa, só `/` e a 404 são definitivas. As demais são provisórias, com o título e uma frase do que virá.
- Cada grupo (público, conta e painel) é um módulo importado com `lazy`, que o Vite separa em um arquivo próprio. O layout público e a 404 ficam no arquivo principal.
- Cada grupo tem um `errorElement` (`RouteError`), então um erro no painel não derruba as páginas públicas. Uma falha ao baixar o módulo, comum logo depois de um deploy, se resolve recarregando a página.
- As páginas abertas por um link com token (`/agendamento`, `/convite` e `/recuperar-senha`) declaram `<meta name="referrer" content="no-referrer">`, para o token não sair no cabeçalho `Referer`.
- `PATHS`, em `src/app/router.tsx`, monta esses caminhos; os testes do roteador os usam.

## Cliente da API (D51 a D53)

### Contrato

O OpenAPI do FastAPI é a referência de campos ([API](07-api.md)). O fluxo, sempre que uma rota mudar:

```bash
# No backend: grava frontend/src/api/openapi.json. Dentro do Docker, a pasta do
# frontend não está montada no container da API, então use a saída padrão:
docker compose exec -T api python -m app.scripts.export_openapi - > frontend/src/api/openapi.json

# No frontend: gera src/api/schema.d.ts
npm run api:types
```

O CI confere os dois arquivos: `export_openapi --check` no job do backend e `api:types` seguido de `git diff --exit-code` no do frontend. A conferência ignora a diferença entre CRLF e LF, por causa do checkout no Windows.

### Endereço

Os caminhos do OpenAPI já começam com `/api/v1`, então a base do cliente é só a origem: `import.meta.env.VITE_API_BASE_URL ?? ''`.

- **Desenvolvimento:** a base é vazia. O Vite repassa `/api` para `VITE_API_PROXY_TARGET` (padrão `http://api:8000`, dentro do Docker; fora dele, `http://localhost:8000`), e frontend e API ficam na mesma origem. O cookie de refresh, com `SameSite=Strict` e `Path=/api/v1/auth`, funciona sem CORS.
- **Produção:** `VITE_API_BASE_URL` é a origem da API, como `https://api.exemplo.com`, definida no build. Frontend e API ficam em subdomínios do mesmo domínio ([Arquitetura](08-arquitetura.md#deploy)), e o cliente envia `credentials: 'include'` para o cookie acompanhar as chamadas de autenticação. A origem do frontend precisa estar em `CORS_ALLOWED_ORIGINS`.

### Erros e repetições

Toda chamada do cliente (`api`, em `src/api/client.ts`) termina de um destes jeitos:

- **Sucesso:** devolve os dados tipados. `unwrap(api.GET(...))` devolve só os dados.
- **`ApiError`:** qualquer resposta fora de 2xx. Traz `status`, `code` (ou `null` quando o corpo não é `problem+json`, como uma página de erro do proxy), `title`, `detail`, `fieldErrors` (cada item com `field`, como `customer.phone`, sem o prefixo `body`), `retryAfterSeconds` no `429` e o corpo completo em `body`, para campos extras como `conflicts`.
- **`NetworkError`:** a requisição não teve resposta. Uma requisição cancelada mantém o `AbortError`, que o TanStack Query ignora.

As mensagens de `fieldErrors` vêm do Pydantic, em inglês; os formulários mostram textos próprios por campo. O texto para o usuário vem de `errorMessage(error)`, em `src/api/messages.ts`, que traduz cada `code` para o português, usa uma mensagem de conexão para `NetworkError`, uma de indisponibilidade para `5xx` sem código e uma genérica para o resto. No `429`, acrescenta quanto tempo esperar. O componente `ErrorMessage` mostra essa mensagem, com um botão opcional de tentar de novo.

O `QueryClient` (`src/api/query-client.ts`) repete uma leitura só depois de `NetworkError` ou `5xx`, no máximo 2 vezes. Um `4xx`, inclusive o `429`, é uma resposta final. Mutações nunca são repetidas, porque podem ter chegado à API. As leituras também não são refeitas ao voltar para a aba e ficam válidas por 30 segundos.

### Sessão

O cliente já aceita um provedor de token de acesso, `setAccessTokenProvider(() => token | null)`, e envia `Authorization: Bearer` quando há token. Ele envia `X-Requested-With` apenas em `/auth/refresh` e `/auth/logout`, as rotas com cookie que exigem o cabeçalho contra CSRF. A etapa de login só pluga a sessão.

**A renovação de sessão precisa ser única entre abas.** O refresh tem rotação sem tolerância: duas chamadas simultâneas com o mesmo cookie, como ao recarregar duas abas, são tratadas como reuso e encerram a sessão. A etapa de login deve serializar `/auth/refresh` entre abas, por exemplo com a Web Locks API, e reler o resultado obtido pela aba que renovou ([Arquitetura](08-arquitetura.md#frontend), UC02).

## Identidade visual (D55)

- **Cores:** *teal* como cor principal e *stone* nos neutros, definidos como tokens do shadcn em `src/index.css`, em OKLCH, com os valores da paleta do Tailwind. No claro, a cor principal é o teal-700; no escuro, o teal-400. Todos os pares de texto e fundo dos tokens passam de 4.5:1 nos dois modos, e o anel de foco passa de 3:1.
- **Forma e fonte:** raio de 0.75rem e fonte Geist.
- **Claro e escuro:** seguem a preferência do sistema. `src/lib/color-scheme.ts` aplica a classe `dark` em `<html>` e acompanha mudanças, então um botão pode entrar depois sem mudar o CSS.
- **Layouts:** o público (`PublicLayout`) é pensado para celular a partir de 360 px. O painel (`PanelLayout`) usa o sidebar do shadcn: menu lateral a partir de 768 px e gaveta abaixo disso.
- **Acessibilidade:** `lang="pt-BR"`, link "Pular para o conteúdo" em cada layout, foco sempre visível (os componentes do shadcn têm anel próprio, e links e elementos com `tabindex` ganham contorno) e textos de leitores de tela traduzidos nos componentes do shadcn.

## Datas e fusos (D56)

As funções de `src/lib/datetime.ts` recebem sempre o fuso do negócio e nunca usam o do navegador: quem abre a página em Tóquio vê os horários de um negócio de São Paulo como o negócio os vê.

| Função | Exemplo |
|---|---|
| `formatDate` | `10/11/2026` |
| `formatTime` | `09:00` |
| `formatWeekday` | `terça-feira` |
| `formatDateTime` | `terça-feira, 10/11/2026 às 09:00`, como nos e-mails (D37) |
| `formatTimeRange` | `09:00–09:30`, ou com as datas quando o intervalo passa da meia-noite local |
| `toLocalDate` | `2026-11-10`, o dia local do negócio |
| `formatLocalDate` | `terça-feira, 10/11/2026`, para datas sem hora, como `date` da disponibilidade |

`parseInstant` aceita instantes com deslocamento, das rotas públicas, e em UTC, das de administração, e recusa uma string sem deslocamento, que o `Date` leria no fuso do navegador.

## Testes (D57)

```bash
npm run test           # Vitest
npm run test:coverage  # com cobertura; mínimo de 80% em src/lib e src/api
npm run typecheck      # tsc -b
npm run api:types      # regenera src/api/schema.d.ts
```

- **Ambiente:** jsdom, com o processo em `TZ=Asia/Tokyo` (definido em `vite.config.ts`), para que qualquer uso do fuso do navegador apareça nos testes.
- **API:** o MSW intercepta as requisições em `http://api.test`, o `VITE_API_BASE_URL` dos testes. Uma requisição sem handler faz o teste falhar. Cada teste troca as respostas com `server.use`.
- **Cobertura:** datas e fusos, inclusive o horário de verão de São Paulo de 2018 e 2019 e um fuso sem horário de verão; o cliente da API (dados tipados, `problem+json`, `Retry-After`, rede, cabeçalhos e política de repetição); o componente de erro; e o roteador.
- **CI:** o job do frontend roda ESLint, `typecheck`, `test:coverage`, a conferência da D51 e o build.

## Uso dos MCPs (D58)

- **shadcn:** consulte os componentes pelo MCP e instale com `npx shadcn add <nome>`. Eles ficam em `src/components/ui` e só mudam para traduzir textos ou atender às regras de lint.
- **Magic:** só em componentes de destaque. Nesta etapa, apenas a seção principal de `/` (`src/components/marketing/HeroSection.tsx`). O resultado é adaptado aos tokens da D55, sem cores fixas e sem dependências fora da D50.
- **chrome-devtools:** cada página nova ou alterada é conferida em 375 px e 1280 px, nos modos claro e escuro, sem rolagem horizontal e sem erros no console.
