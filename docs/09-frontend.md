# 9. Frontend

SPA com Vite, React, TypeScript, Tailwind CSS e shadcn/ui, na pasta `frontend/`. As decisões do frontend são a D50 a D65 dos [Pontos a revisar](README.md#pontos-a-revisar).

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
├── features/
│   └── booking/  # Agendamento público (UC10 e UC11): componentes, consultas e formulário
├── hooks/        # Hooks compartilhados, como o use-mobile do sidebar
├── lib/          # Funções puras: datas e fusos, esquema de cores, prévia da demo e utilitários
├── pages/        # Páginas por grupo de rotas: public/, account/, panel/ e a 404
└── test/         # Configuração do Vitest e servidor do MSW com os handlers
```

Os testes ficam ao lado do código, como `datetime.test.ts`. As páginas ficam agrupadas por grupo de rotas, e não em uma lista plana, porque cada grupo é um módulo carregado sob demanda (D54). `features/` reúne, por funcionalidade, os componentes, as consultas do TanStack Query e os formulários; as páginas apenas os compõem.

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

- `/`, `/n/:slug` e a 404 são definitivas. As demais são provisórias, com o título e uma frase do que virá.
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

- **Desenvolvimento:** a base é vazia. O Vite repassa `/api` para `VITE_API_PROXY_TARGET` (padrão `http://api:8000`, dentro do Docker; fora dele, `http://localhost:8002`), e frontend e API ficam na mesma origem. O cookie de refresh, com `SameSite=Strict` e `Path=/api/v1/auth`, funciona sem CORS.
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

## Identidade visual (D55, D59 a D62)

Agendamento para barbearia, salão e estética: o cliente marca pelo celular, e a equipe usa o painel no balcão, sob luz forte. A direção é **vinho e eucalipto sobre porcelana**: vinho (couro da cadeira de barbeiro, o "marsala" do salão) como cor de ação, eucalipto (spa, toalha verde) como cor de apoio e de sucesso, e neutros de porcelana levemente rosados, sem creme. Os valores ficam em `src/index.css`, que é a referência do design system (D62).

### Cores

Tokens do shadcn em OKLCH, mais os de sucesso (D60). Claro e escuro seguem a preferência do sistema: `src/lib/color-scheme.ts` aplica a classe `dark` em `<html>` e acompanha mudanças, então um botão pode entrar depois sem mudar o CSS.

| Token | Claro | Escuro | Uso |
|---|---|---|---|
| `primary` | `oklch(0.43 0.125 5)` | `oklch(0.79 0.085 5)` | Vinho; no escuro, a versão clara (rosé). Botão principal, links, item ativo |
| `accent` / `accent-foreground` | `0.95 0.022 5` / `0.40 0.115 5` | `0.29 0.05 5` / `0.89 0.05 5` | Hover, item ativo do menu, horário escolhido |
| `success` / `success-foreground` | `0.47 0.075 168` / `0.99 0.004 350` | `0.78 0.09 168` / `0.20 0.035 168` | Eucalipto: só apoio e sucesso, nunca uma segunda cor de ação |
| `success-soft` / `success-soft-foreground` | `0.95 0.025 168` / `0.38 0.065 168` | `0.27 0.04 168` / `0.86 0.07 168` | Selos "Confirmado" e "Concluído" |
| `destructive` | `oklch(0.53 0.155 42)` | `oklch(0.77 0.12 42)` | Vermelhão, de matiz alaranjado, longe do vinho |
| `background` / `foreground` | `0.99 0.004 350` / `0.22 0.025 355` | `0.165 0.012 355` / `0.965 0.005 355` | Porcelana e tinta |
| `muted-foreground` | `0.48 0.022 355` | `0.74 0.018 355` | Texto de apoio |
| `input` | `0.64 0.015 355` | `0.52 0.016 355` | Borda de campo e fundos `bg-input/*`, nunca texto. Opaca: um branco translúcido se mistura em sRGB e fica abaixo de 3:1 |
| `ring` | `0.53 0.14 5` | `0.70 0.12 5` | Anel de foco (D61) |

Contraste medido na página renderizada, com o chrome-devtools:

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| `foreground` / `background` | 16.94 | 17.40 | 4.5 |
| `muted-foreground` / `background` | 6.42 | 8.29 | 4.5 |
| `muted-foreground` / `muted` | 5.92 | 6.80 | 4.5 |
| `primary-foreground` / `primary` | 8.45 | 8.96 | 4.5 |
| `primary` / `background` (texto e links) | 8.45 | 9.62 | 4.5 |
| `accent-foreground` / `accent` | 8.44 | 10.19 | 4.5 |
| `destructive` / `background` | 5.48 | 8.98 | 4.5 |
| `destructive` / fundo `destructive/10` | 4.75 | 7.75 | 4.5 |
| `success-foreground` / `success` | 6.39 | 9.30 | 4.5 |
| `success-soft-foreground` / `success-soft` | 8.46 | 9.90 | 4.5 |
| `foreground` / `sidebar` | 16.15 | 16.71 | 4.5 |
| `ring` / `background`, `card` e `muted` | 5.54 / 5.70 / 5.11 | 6.81 / 6.36 / 5.59 | 3 |
| `input` / `background` | 3.28 | 3.47 | 3 |

- **Ação destrutiva:** sempre com ícone e texto, nunca só a cor, e nunca como botão sólido ao lado do principal. A variante `destructive` do botão e do selo usa fundo `/10` nos dois modos, e o hover muda a borda em vez de escurecer o fundo (D58).
- **Gráficos:** `chart-1` a `chart-5` alternam vinho e eucalipto, para quando houver gráficos.

### Tipografia (D59)

- **Geist** (`--font-sans`) no corpo, nos formulários, nos botões e nos horários. Horários e preços usam `tabular-nums`.
- **Bricolage Grotesque** (`--font-heading`) só em títulos: `h1` e `h2`, títulos de card e de sheet, nome do negócio e a marca. Entrou só o eixo de peso (41 KB no latim); o arquivo com tamanho óptico pesava quase o dobro.
- Escala: `h1` de 2.375rem no celular a 3.25rem no desktop, com altura de linha 1.05; `h2` de 1.75rem a 1.875rem; `h3` em 1.125rem, Geist 600; corpo em 1rem com altura de linha 1.5; nada abaixo de 0.75rem. Os títulos usam `letter-spacing: -0.015em` e `text-wrap: balance`.
- As duas fontes vêm do `@fontsource`, com versão exata (D50), sem CDN.

### Forma, sombras e movimento (D60)

- **Raio:** `--radius` de 0.625rem: 10 px em botões e campos, 14 px em cards (`rounded-xl`) e pílula nos horários e selos.
- **Sombras:** `shadow-xs` a `shadow-lg` em duas camadas, tingidas com a cor do texto no claro. No escuro, a elevação vem da superfície mais clara, da borda e de um brilho no topo.
- **Movimento:** `--duration-fast` (120 ms, hover e toque), `--duration-base` (200 ms) e `--duration-slow` (300 ms, gavetas), com `ease-enter` (`cubic-bezier(0.2, 0, 0, 1)`) e `ease-exit` (`cubic-bezier(0.4, 0, 1, 1)`). Só CSS e `tw-animate-css`. Com `prefers-reduced-motion: reduce`, animações e transições ficam instantâneas.
- **Navegador:** seleção de texto, cursor de digitação, `accent-color`, barra de rolagem e sublinhado dos links seguem a paleta.

### Foco e acessibilidade (D61)

- **Foco:** todo `:focus-visible` recebe contorno sólido de 2 px em `--ring`, deslocado 2 px. A regra fica fora das camadas do Tailwind, então vence o `outline-none` dos componentes do shadcn; o halo deles continua como enfeite. O deslocamento faz o anel ser medido contra o fundo da página, e não contra o vinho do botão.
- **Diálogos:** o contêiner que o Radix foca ao abrir um diálogo (`role="dialog"` com `tabindex="-1"`) não recebe o contorno, porque não é um controle.
- **Gaveta do painel:** fecha com Esc, tocando fora ou escolhendo um item, como no shadcn. O Radix só devolve o foco a um `SheetTrigger`, e o Sidebar abre a gaveta com um botão comum; por isso o botão "Menu" retoma o foco ao fechar, assim que o Radix tira o `aria-hidden` do resto da página.
- **Toque:** alvos de pelo menos 44 px nas páginas públicas e no painel abaixo de 768 px (cabeçalho, botão "Menu" com rótulo e itens da gaveta). A partir de 768 px, o menu lateral volta à densidade do shadcn.
- `lang="pt-BR"`, link "Pular para o conteúdo" em cada layout e textos de leitores de tela traduzidos nos componentes do shadcn.

### Layouts e página inicial

- **Público** (`PublicLayout`): pensado para celular a partir de 360 px. O rodapé é o único lugar que cita o projeto de portfólio.
- **Painel** (`PanelLayout`): sidebar do shadcn, com menu lateral a partir de 768 px e gaveta abaixo disso.
- **Marca** (`Brand`): glifo próprio em SVG, com três fichas de horário e a do meio escolhida.
- **Página inicial:** texto para o dono do negócio. A prévia da hero é uma ilustração estática numa moldura de celular, escondida dos leitores de tela; os horários não têm borda, hover nem cursor de clique. A data mostrada é o próximo dia de expediente da demo, a partir de hoje no fuso do negócio (`src/lib/demo-preview.ts`). "Como funciona" mostra três passos, cada um com um recorte da interface em vez de ícone.

## Agendamento público (UC10 e UC11)

`/n/:slug` mostra o negócio (`GET /public/businesses/{slug}`) e o fluxo de agendamento. O código fica em `src/features/booking`; a página (`src/pages/public/BusinessPage.tsx`) só escolhe entre carregando, não encontrado, erro e o fluxo.

| Arquivo | Conteúdo |
|---|---|
| `queries.ts` | `businessQuery`, `availabilityQuery` e `useCreateBooking`, com as chaves `['public', 'business', slug, ...]` |
| `use-booking-flow.ts` | Estado do fluxo a partir da URL e do histórico (D65) |
| `idempotency.ts` | Chave de idempotência por tentativa (D64) |
| `customer-schema.ts` | Esquema zod dos dados do cliente, textos em português e conversão para E.164 (D63) |
| `components/` | Passos, escolha de dia e horário, resumo, tela de sucesso e página de não encontrado |

### Passos

1. **Serviço:** lista de opções com duração e preço. Um serviço ativo sem profissional aparece desabilitado.
2. **Profissional:** "Qualquer profissional" (padrão, sem `professional_id`, RN10) ou um dos aptos ao serviço. Com um só profissional, o passo é pulado e o nome aparece no resumo.
3. **Dia e horário:**
   - **Dias:** uma faixa de hoje até hoje + `max_advance_days`, no fuso do negócio. Cada dia é buscado quando é escolhido.
   - **Horários:** agrupados em manhã, tarde e noite.
   - **Dia vazio:** fechado, lotado ou fora da antecedência, mostra um estado vazio com um botão para o dia seguinte, e o "Continuar" some. No último dia aberto, a mensagem pede um dia anterior.
   - **Um dia por vez:** o botão avança só um dia, de propósito, mesmo que o seguinte também esteja fechado (na demo, domingo leva à segunda). Procurar o próximo dia com horários exigiria buscar vários dias seguidos e gastaria o limite de 120 requisições por minuto da API.
   - **Celular:** o botão "Continuar com HH:MM" fica fixo no rodapé, e os horários têm `scroll-margin` para não ficarem sob ele.
4. **Seus dados:** nome, e-mail e telefone, validados ao sair do campo e no envio. O erro aparece abaixo de cada campo (`aria-describedby`), e o foco vai para o primeiro inválido.
5. **Sucesso:**
   - Mostra serviço, profissional (o atribuído, quando foi "qualquer"), dia e horário no fuso do negócio.
   - O `access_url` aparece num campo só de leitura, com o botão de copiar. Sem a área de transferência, o link fica selecionado para a cópia manual.

Cada passo tem o título com "N de M" ao lado e uma barra de progresso. Ao abrir um passo depois de uma escolha, o foco vai para o título. No desktop, o resumo fica fixo à direita; no celular, acima do passo. O aviso da RN29 aparece quando `is_demo` é verdadeiro (D48).

### Respostas da API

| Resposta | Comportamento |
|---|---|
| `404` no negócio | Página "Não encontramos este negócio", com links para o início e para a demo |
| `409 SLOT_UNAVAILABLE` | Recarrega a disponibilidade, volta para os horários já atualizados e explica que o horário foi reservado. Os dados digitados ficam guardados |
| `409 IDEMPOTENCY_KEY_REUSED` | Mensagem padrão e nova chave na próxima tentativa |
| `422` com `customer.*` | Texto próprio no campo correspondente; as mensagens do Pydantic nunca aparecem |
| `429` | Mensagem com o tempo de espera, e o botão fica em "Aguarde N s" até o `Retry-After` passar |
| Falha de rede | Mensagem de conexão com "Tentar de novo", que reenvia o mesmo corpo com a mesma chave |
| `email_status: "skipped"` | O link aparece com o aviso de que o e-mail não foi enviado e de que ele só está naquela tela (RN26) |
| `email_status: "unchanged"` | Repetição de um agendamento já feito: `access_url` vem nulo, e a tela diz que o link foi para o e-mail (RN13) |

### Idempotência (D64)

Uma tentativa é um corpo exato. `useIdempotencyKey` guarda a chave e o corpo serializado da última tentativa:
- **Mesmo corpo:** reaproveita a chave. Assim, um clique duplo ou um "Tentar de novo" depois de uma falha de rede nunca criam dois agendamentos.
- **Corpo diferente:** gera uma nova chave com `crypto.randomUUID()`. Uma tentativa depois de um `409` ou de um `422` muda o corpo, então nunca cai em `IDEMPOTENCY_KEY_REUSED`.

O envio também fica barrado enquanto a requisição anterior não termina. Quem barra é uma referência marcada no próprio clique, antes de o React redesenhar o botão.

### Estado na URL (D65)

`?servico=<id>&profissional=<id|qualquer>&dia=<AAAA-MM-DD>`.

- **Histórico:** escolher serviço ou profissional cria uma entrada, então o "voltar" do celular volta um passo. Trocar de dia substitui a entrada.
- **Horário:** vai no estado da entrada do histórico (`location.state`) e só vale se a disponibilidade atual ainda o oferece.
- **Dados do cliente:** ficam só na memória, nunca na URL.
- **Parâmetro inválido:** é ignorado, e o fluxo começa no primeiro passo que falta. Vale para serviço inexistente, inativo ou sem profissional, profissional que não atende o serviço e dia inválido ou fora da antecedência.

### Telefone e moeda (D63)

O telefone é convertido para E.164 antes do envio. Sem `+`, o número é brasileiro: DDD e número, com ou sem o 0 ou o 55 na frente, como `(11) 98765-4321` → `+5511987654321`. Com `+`, vale o código do país digitado. Os preços são formatados em reais (`src/lib/format.ts`).

**Limitação conhecida:** a API não tem país nem moeda por negócio. Um negócio de outro país precisaria dos dois campos, para o telefone digitado sem `+` e para os preços.

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
| `formatLocalDayParts` | `{ weekday: 'ter', day: '10', month: 'nov' }`, para a faixa de dias |
| `addLocalDays`, `localDateRange` e `isLocalDate` | Contas e validação de dias do calendário, sem fuso |
| `localHour` | A hora (0 a 23) no fuso do negócio, para agrupar os horários por período |

`parseInstant` aceita instantes com deslocamento, das rotas públicas, e em UTC, das de administração, e recusa uma string sem deslocamento, que o `Date` leria no fuso do navegador.

## Testes (D57)

```bash
npm run test           # Vitest
npm run test:coverage  # com cobertura; mínimo de 80% em src/lib, src/api e src/features/booking
npm run typecheck      # tsc -b
npm run api:types      # regenera src/api/schema.d.ts
```

- **Ambiente:** jsdom, com o processo em `TZ=Asia/Tokyo` (definido em `vite.config.ts`), para que qualquer uso do fuso do navegador apareça nos testes. O `setup.ts` substitui `matchMedia` e `ResizeObserver`, que o jsdom não tem. Os testes do agendamento fixam o relógio num instante em que o dia de São Paulo e o de Tóquio são diferentes, com `vi.useFakeTimers({ toFake: ['Date'] })`.
- **API:** o MSW intercepta as requisições em `http://api.test`, o `VITE_API_BASE_URL` dos testes. Uma requisição sem handler faz o teste falhar. Cada teste troca as respostas com `server.use`.
- **Cobertura:** datas e fusos, inclusive o horário de verão de São Paulo de 2018 e 2019 e um fuso sem horário de verão; o cliente da API (dados tipados, `problem+json`, `Retry-After`, rede, cabeçalhos e política de repetição); o componente de erro; o roteador; preços e durações; e o agendamento público (negócio e slug inexistente, horários no fuso do negócio, dia sem horários, teclado, parâmetros inválidos, idempotência com clique duplo e falha de rede, `409`, `429`, `422`, limite de e-mail, repetição sem link e tela de sucesso).
- **CI:** o job do frontend roda ESLint, `typecheck`, `test:coverage`, a conferência da D51 e o build.

## Uso dos MCPs (D58)

- **shadcn:** consulte os componentes pelo MCP e instale com `npx shadcn add <nome>`. Eles ficam em `src/components/ui` e só mudam para traduzir textos, atender às regras de lint ou alcançar o contraste AA (como a variante `destructive` do botão e do selo).
- **Magic:** só em componentes de destaque: a seção principal de `/` e a escolha de dia e horário. O resultado é adaptado aos tokens, sem cores fixas e sem dependências fora da D50. A moldura de celular da hero veio do "Great UI Mobile Mockup" (21st.dev, id 23322, MIT), sem o framer-motion. O `DateTimePicker` veio do "Time Slot Picker" (21st.dev, klyv-ui, id 43217), que não tem dependências. Manteve os dois grupos de rádio navegáveis pelo teclado e o fuso sempre impresso. Trocou as datas no fuso do navegador pelas de `src/lib/datetime.ts`, a carga de todos os dias pela de um dia por vez, as cores pelos tokens e os alvos para 44 px, e passou a agrupar os horários por período.
- **chrome-devtools:** cada página nova ou alterada é conferida em 375 px e 1280 px, nos modos claro e escuro, sem rolagem horizontal, sem erros no console, com o contraste dos pares da tabela medido na página e o foco conferido pelo teclado.
- **Arquivos de design system (D62):** nada de `design-system/`, `PRODUCT.md` ou `DESIGN.md` no repositório. A referência é `src/index.css` mais esta seção.
