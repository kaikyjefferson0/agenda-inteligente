# Deploy

Como o Agenda Inteligente está publicado e o passo a passo para refazer o deploy do zero. O site fica no Render (Static Site), a API também (Web Service grátis), o banco no Neon e os e-mails pelo Resend, com o domínio `kaikyjefferson.dev`, registrado na Cloudflare. As decisões são a D105 a D119 do [registro](README.md#pontos-a-revisar), e o motivo de cada escolha está em [Produção](08-arquitetura.md#produção). A configuração dos dois serviços está em [`render.yaml`](../render.yaml).

**Em produção hoje:**

| O quê | Endereço |
|---|---|
| Site | <https://agenda.kaikyjefferson.dev> |
| Demo pública | <https://agenda.kaikyjefferson.dev/n/barbearia-demo> |
| API | <https://api-agenda.kaikyjefferson.dev> |
| Endereços `*.onrender.com` | Desligados (PR #33): respondem `404` |

Siga os passos na ordem. Os de configuração trazem um **Se der errado** e um **Como voltar**. Os recursos gerais, que valem para qualquer passo, estão em [Quando algo dá errado](#13-quando-algo-dá-errado).

Os comandos são para o terminal `cmd` do Windows. O `curl` já vem no Windows 10 e 11. Onde aparecer `<...>`, troque pelo valor do painel. **Todos os valores de exemplo deste guia são fictícios**: nenhuma chave, senha ou URL de banco real fica no repositório.

## Sumário

0. [Antes de começar](#0-antes-de-começar)
1. [Arquitetura de produção](#1-arquitetura-de-produção)
2. [Variáveis de ambiente](#2-variáveis-de-ambiente)
3. [Criar o banco no Neon](#3-criar-o-banco-no-neon)
4. [Resend: domínio e chave](#4-resend-domínio-e-chave)
5. [Criar os serviços no Render pelo Blueprint](#5-criar-os-serviços-no-render-pelo-blueprint)
6. [Conferir o primeiro deploy](#6-conferir-o-primeiro-deploy)
7. [Domínio na Cloudflare: DNS, proxy e SSL](#7-domínio-na-cloudflare-dns-proxy-e-ssl)
8. [Verificar o domínio no Resend](#8-verificar-o-domínio-no-resend)
9. [Desligar os endereços `.onrender.com`](#9-desligar-os-endereços-onrendercom)
10. [Teste de fumaça](#10-teste-de-fumaça)
11. [Limitações do plano gratuito](#11-limitações-do-plano-gratuito)
12. [Problemas já resolvidos](#12-problemas-já-resolvidos)
13. [Quando algo dá errado](#13-quando-algo-dá-errado)
14. [Anexo: restauração manual da demo](#14-anexo-restauração-manual-da-demo)

## 0. Antes de começar

- **Contas:** Cloudflare (registro e DNS do domínio), Neon, Resend e Render. O Render usa o mesmo workspace em que já está o Estoque, no plano Hobby. As 750 horas, os 5 GB de banda e os 2 domínios incluídos são divididos entre os dois projetos (D119). Não cadastre forma de pagamento: sem ela, passar de um limite suspende os serviços em vez de cobrar.
- **Domínio:** `kaikyjefferson.dev`, comprado na Cloudflare em **Domain Registration → Register Domains**, por 1 ano e com renovação automática. O domínio já vem com o DNS da Cloudflare. Antes de seguir, em **DNS → Records**, confira que a zona está vazia ou só tem registros que você reconhece, e anote se existe algum `CAA`, que importa no [passo 7](#7-domínio-na-cloudflare-dns-proxy-e-ssl). Com outro domínio, os nomes do `render.yaml`, do `frontend/csp.ts` e das decisões D107 a D117 mudam num PR antes de seguir.
- **No computador:** `python` e `uv`, para o teste da URL do banco e a restauração manual da demo, e `npm`, na pasta `frontend`, para o teste de fumaça.
- **No repositório:** o Render lê o `render.yaml` da `main`, e cada commit na `main` só é publicado depois de o CI passar (`autoDeployTrigger: checksPass`).
- **Conferência da CSP:** `npm run check:render`, na pasta `frontend`, confere se a CSP do `render.yaml` é igual à de `frontend/csp.ts`. O CI roda a mesma conferência. Para mudar a CSP, mude os dois arquivos no mesmo commit.

## 1. Arquitetura de produção

| Peça | Quem hospeda | O que faz |
|---|---|---|
| `agenda-site` | Render, Static Site (CDN global) | O frontend React já compilado (`frontend/dist`), com os cabeçalhos de segurança e a CSP do `render.yaml` |
| `agenda-api` | Render, Web Service grátis em Virginia | A API FastAPI, num processo só, que também envia a fila de e-mails (D105), restaura a demo uma vez por dia (D106) e faz a limpeza diária (D115). Roda as migrações a cada partida (D113) |
| Banco | Neon, Postgres em AWS `us-east-1` | Os dados, pela conexão direta (sem pooler), com o compute fixo em 0,25 CU |
| E-mails | Resend, região São Paulo | O envio de `nao-responda@mail.kaikyjefferson.dev`, chamado pela API por HTTPS |
| Domínio e DNS | Cloudflare | O registro do domínio e os registros `CNAME` e `TXT`, todos como **DNS only** |
| Código e CI | GitHub | A `main` e o CI. O Render só publica um commit depois de o CI passar |

```mermaid
flowchart LR
    V["Navegador do visitante"]
    CF["Cloudflare DNS<br/>(DNS only, sem proxy)"]
    S["Render: agenda-site<br/>agenda.kaikyjefferson.dev"]
    A["Render: agenda-api<br/>api-agenda.kaikyjefferson.dev<br/>API + worker de e-mails + restauração"]
    N[("Neon Postgres<br/>us-east-1")]
    R["Resend<br/>mail.kaikyjefferson.dev"]
    C["Caixa de e-mail do cliente"]
    GH["GitHub: main + CI"]

    V -. "resolve os nomes" .-> CF
    V -- "HTTPS" --> S
    V -- "HTTPS (fetch + cookie)" --> A
    A -- "asyncpg, SSL, conexão direta" --> N
    A -- "HTTPS, API do Resend" --> R
    R -- "SPF + DKIM" --> C
    GH -- "deploy quando o CI passa" --> S
    GH -- "deploy quando o CI passa" --> A
```

O site e a API ficam em subdomínios do mesmo domínio por causa do cookie `__Host-refresh_token`, `SameSite=Strict` (D108). Dois endereços `*.onrender.com` seriam sites diferentes para o navegador (o `onrender.com` está na Public Suffix List), e o cookie não iria do site para a API.

## 2. Variáveis de ambiente

Os valores fixos já estão no `render.yaml`. Os segredos marcados com `sync: false` são pedidos pelo painel do Render uma vez, na criação do Blueprint ([passo 5](#5-criar-os-serviços-no-render-pelo-blueprint)), e uma sincronização posterior nunca os sobrescreve. `JWT_SECRET` e `RATE_LIMIT_KEY_SECRET` o Render gera sozinho (`generateValue: true`, 44 caracteres).

**Onde configurar:**

- **`render.yaml`:** valor fixo, que muda por commit.
- **Gerada pelo Render:** nada a fazer. Para trocar, veja [Trocar os segredos](#trocar-os-segredos).
- **Painel do Render:** em **Environment** do serviço. O valor vem do Neon, do Resend ou é gerado por você.
- **Terminal local:** só para o teste de fumaça, nunca no Render.

Os exemplos abaixo são **fictícios**.

### API (`agenda-api`)

| Variável | Onde configurar | Para que serve | Exemplo fictício |
|---|---|---|---|
| `PYTHON_VERSION` | `render.yaml` | Versão do Python no build e na execução, a mesma do `backend/Dockerfile` | `3.14.10` |
| `UV_VERSION` | `render.yaml` | Versão do uv que o Render instala | `0.13.7` |
| `PORT` | Definida pelo Render; não declare | Porta em que o uvicorn escuta (`--port $PORT`) | `10000` |
| `DATABASE_URL` | Painel do Render (`sync: false`), com o valor do Neon convertido no passo 3 | Conexão direta com o banco, sem `-pooler`. Usada pelas migrações, pela API e pelo worker | `postgresql+asyncpg://usuario_exemplo:senha-ficticia@ep-exemplo-000000.us-east-1.aws.neon.tech/banco_exemplo?ssl=require` |
| `JWT_SECRET` | Gerada pelo Render | Assina os tokens de acesso. Trocar encerra todas as sessões | `ZXhlbXBsby1maWN0aWNpby1uYW8tdXNlLWVzdGUtdmFsb3I=` |
| `RATE_LIMIT_KEY_SECRET` | Gerada pelo Render | Chave do HMAC que esconde o IP e o e-mail nos contadores de limite. Trocar zera os contadores | `b3V0cm8tZXhlbXBsby1maWN0aWNpby1wYXJhLW8tZ3VpYQ==` |
| `REGISTRATION_ENABLED` | `render.yaml` | Cadastro de novos negócios. A demo pública não aceita cadastro | `false` |
| `CORS_ALLOWED_ORIGINS` | `render.yaml` | A única origem do CORS e do `Origin` conferido no refresh e no logout (D109, D110), sem barra no fim | `https://agenda.kaikyjefferson.dev` |
| `FRONTEND_BASE_URL` | `render.yaml` | Base dos links nos e-mails | `https://agenda.kaikyjefferson.dev` |
| `TRUSTED_CLIENT_IP_HEADER` | `render.yaml` | Cabeçalho com o IP do visitante, usado nos limites (D118) | `True-Client-IP` |
| `EMAIL_BACKEND` | `render.yaml` | Envio pelo Resend. A API não sobe sem a `RESEND_API_KEY` | `resend` |
| `EMAIL_FROM` | `render.yaml` | Remetente dos e-mails (D111) | `Agenda Inteligente <nao-responda@mail.kaikyjefferson.dev>` |
| `RESEND_API_KEY` | Painel do Render (`sync: false`), com o valor do Resend (passo 4) | Chave da API do Resend, só com permissão de envio | `re_EXEMPLO0000_nao_e_uma_chave_real` |
| `EMAIL_DAILY_CAP` | `render.yaml` | Teto diário de e-mails. O limite do Resend grátis é por conta | `100` |
| `EMAIL_RECIPIENT_DAILY_CAP` | `render.yaml` | E-mails por destinatário por dia | `3` |
| `EMAIL_WORKER_IN_PROCESS` | `render.yaml` | A API envia a fila de e-mails a cada 5 s (D105) | `true` |
| `DEMO_RESTORE_IN_PROCESS` | `render.yaml` | A API restaura a demo uma vez por dia, depois das 03:00 de `America/Sao_Paulo` (D106). Ligada, a API não sobe sem um `DEMO_PASSWORD` válido | `true` |
| `DEMO_PASSWORD` | Painel do Render (`sync: false`), gerada por você (passo 4) | Senha das contas `dono@demo.example.com` e `profissional@demo.example.com`, de 12 a 128 caracteres. Vale a partir da próxima restauração | `exemplo-ficticio-senha-da-demo-32c` |

`SMTP_HOST` e `SMTP_PORT` não entram, porque só valem com `EMAIL_BACKEND=smtp`, e o Render bloqueia as portas de SMTP no plano grátis. As variáveis de desenvolvimento estão no [`.env.example`](../.env.example).

### Build do site (`agenda-site`)

Todas são lidas no `npm run build`, então mudar qualquer uma exige um novo deploy do site. Toda variável `VITE_` vai para o JavaScript público.

| Variável | Onde configurar | Para que serve | Exemplo fictício |
|---|---|---|---|
| `NODE_VERSION` | `render.yaml` | Versão do Node no build, a mesma do `frontend/Dockerfile` | `24.22.2` |
| `VITE_API_BASE_URL` | `render.yaml` | Origem da API, sem caminho nem barra no fim. O build falha se ela não estiver no `connect-src` da CSP | `https://api-agenda.kaikyjefferson.dev` |
| `VITE_DEMO_PASSWORD` | Painel do Render (`sync: false`) | Senha do atalho "Conhecer pela demonstração" em `/entrar` (D75). **Igual ao `DEMO_PASSWORD`** | `exemplo-ficticio-senha-da-demo-32c` |

`VITE_API_PROXY_TARGET` e `VITE_USE_POLLING` só existem no desenvolvimento.

### Teste de fumaça (terminal local)

Todas são opcionais. Os detalhes estão no [passo 10](#10-teste-de-fumaça) e em [`frontend/smoke/README.md`](../frontend/smoke/README.md).

| Variável | Onde configurar | Para que serve | Exemplo fictício |
|---|---|---|---|
| `SMOKE_BASE_URL` | Terminal local | Outro site em vez da produção | `https://agenda.exemplo.dev` |
| `SMOKE_API_URL` | Terminal local | Outra API. Precisa ser a mesma do `VITE_API_BASE_URL` do build do site | `https://api.exemplo.dev` |
| `SMOKE_WARMUP_SECONDS` | Terminal local | Quanto esperar o `/health` antes de começar, para a API acordar. Padrão `90` | `120` |
| `SMOKE_CUSTOMER_EMAIL` | Terminal local | E-mail do cliente no agendamento. Padrão: um endereço de teste do Resend, que não chega a nenhuma caixa | `voce@exemplo.com` |
| `SMOKE_LONG` | Terminal local | `1` liga o teste da expiração do token de acesso | `1` |
| `SMOKE_LONG_MINUTES` | Terminal local | Quanto esse teste espera. Padrão `16` | `16` |
| `SMOKE_RATE_LIMIT` | Terminal local | `1` liga o teste do `429` no login | `1` |

## 3. Criar o banco no Neon

1. **New Project**:
   - **Nome:** `agenda`.
   - **Região:** AWS `us-east-1` (N. Virginia), ao lado da API.
   - **Postgres:** a versão 18, a mesma do CI, se estiver disponível; senão, a mais nova oferecida.
2. Em **Compute**, deixe o mínimo e o máximo em **0,25 CU** (compute fixo, D115). O Neon dorme depois de 5 minutos sem uso, e isso não se desliga no plano grátis.
3. Em **Connect**, com o branch **`production`** (o branch padrão que o Neon cria), **desligue "Connection pooling"**. O host não pode ter `-pooler`: as migrações e a trava da restauração não funcionam pelo pooler. Copie a URL. Ela tem este formato:

   ```text
   postgresql://<usuário>:<senha>@<host>.us-east-1.aws.neon.tech/<banco>?sslmode=require&channel_binding=require
   ```

4. Converta para o formato do asyncpg: troque `postgresql://` por `postgresql+asyncpg://` e a consulta inteira por `?ssl=require`, sem `channel_binding`:

   ```text
   postgresql+asyncpg://<usuário>:<senha>@<host>.us-east-1.aws.neon.tech/<banco>?ssl=require
   ```

5. Teste a URL da sua máquina, sem alterar nada no banco. Os dois segredos abaixo só satisfazem a validação da configuração e não servem para mais nada:

   ```bat
   cd backend
   set "DATABASE_URL=postgresql+asyncpg://<usuário>:<senha>@<host>.us-east-1.aws.neon.tech/<banco>?ssl=require"
   set JWT_SECRET=somente-teste-local-da-url-0000000001
   set RATE_LIMIT_KEY_SECRET=somente-teste-local-da-url-0000000002
   uv run alembic current
   ```

   O comando deve terminar sem erro. Num banco novo, ele não mostra nenhuma revisão. Feche o terminal depois, para a URL não ficar nas variáveis da sessão.

**Se der errado:**

- **`invalid connection option "sslmode"` ou `"channel_binding"`:** a consulta da URL não foi trocada por `?ssl=require` (o asyncpg trata opções desconhecidas como configurações do servidor).
- **`password authentication failed`:** a senha foi copiada mascarada (`****`). No **Connect**, mostre a senha antes de copiar.
- **Tempo esgotado:** o compute estava dormindo e demorou a acordar, ou a rede bloqueia a porta 5432. Rode de novo, ou teste de outra rede.

**Como voltar:** apague o projeto em **Settings → Delete project**. Nada mais depende dele ainda.

## 4. Resend: domínio e chave

Este passo vem antes do Render porque o Blueprint pede os valores `sync: false` na criação, e a API não sobe com `EMAIL_BACKEND=resend` sem a chave. A verificação do domínio só termina no [passo 8](#8-verificar-o-domínio-no-resend), depois do DNS.

### Senha da demo

```bat
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

O comando imprime 32 caracteres, dentro dos 12 a 128 exigidos. Esse mesmo valor vai no `DEMO_PASSWORD` e no `VITE_DEMO_PASSWORD`. Ele é público de propósito, porque vai no JavaScript do site (D75), e a RN28 trava o que a demo pode fazer. Nunca o reaproveite em outra conta.

### Domínio no Resend

1. Em **Domains → Add Domain**, adicione `mail.kaikyjefferson.dev`, o subdomínio só para envio (D111), e não a raiz.
2. **Região:** São Paulo (`sa-east-1`), a usada em produção. Os registros de DNS do [passo 7](#7-domínio-na-cloudflare-dns-proxy-e-ssl) dependem da região: com outra, valem os valores que o painel mostrar.
3. O Resend mostra os registros de DNS e deixa o domínio como **Pending** até o passo 8.

### Chave da API

1. Em **API Keys → Create API Key**:
   - **Nome:** `agenda-render`.
   - **Permission:** **Sending access**.
   - **Domain:** **All domains**. O Resend não deixa restringir a chave a um domínio que ainda está **Pending**, e é o caso aqui. Na produção, a chave ficou assim, e `mail.kaikyjefferson.dev` é o único domínio verificado na conta.
2. Copie a chave (`re_...`) e guarde no gerenciador de senhas até o passo 5. O Resend não a mostra de novo.

**Se der errado:** se a chave se perder antes do passo 5, apague-a e crie outra.

**Como voltar:** apague a chave em **API Keys** e o domínio em **Domains**.

## 5. Criar os serviços no Render pelo Blueprint

1. No Render, **New → Blueprint**. Escolha o repositório `agenda-inteligente`, a branch `main` e o nome `agenda-inteligente`. O Render lê o `render.yaml` e lista os dois serviços, `agenda-api` e `agenda-site`.
2. Preencha os segredos que o painel pede:
   - `DATABASE_URL`: a URL convertida no passo 3.
   - `RESEND_API_KEY`: a chave do passo 4.
   - `DEMO_PASSWORD`: a senha do passo 4.
   - `VITE_DEMO_PASSWORD`: a mesma senha.

   `JWT_SECRET` e `RATE_LIMIT_KEY_SECRET` o Render gera sozinho. Os valores `sync: false` só são pedidos agora: uma sincronização posterior do Blueprint nunca os pede de novo nem os sobrescreve.
3. **Apply.** O Render cria os dois serviços e faz o primeiro deploy de cada um. Ele também cadastra os domínios do campo `domains`, que ficam como não verificados até o passo 7.

Num deploy do zero, o `render.yaml` atual já traz `renderSubdomainPolicy: disabled`, mas o Render só aceita esse valor num serviço que já tem domínio próprio. Se o **Apply** recusar o campo, crie o Blueprint a partir de um commit sem essas duas linhas e religue a opção no [passo 9](#9-desligar-os-endereços-onrendercom), como foi feito na produção.

**Sincronização do Blueprint:** na produção, o Blueprint está em **Manual sync**. Depois de um merge que muda o `render.yaml`, abra **Blueprints → agenda-inteligente** e clique em **Manual Sync** para aplicar a mudança. Os deploys de código continuam automáticos, pelo `checksPass`.

**Se der errado:**

- **O Render recusa o `render.yaml`:** a mensagem diz o campo. Corrija num PR e crie o Blueprint de novo.
- **Um segredo foi preenchido errado:** corrija em **agenda-api → Environment** (ou no site) e salve com **Save, rebuild, and deploy**. Para o `VITE_DEMO_PASSWORD`, o site precisa de um novo build.

**Como voltar:** apague os dois serviços em **Settings → Delete Web Service** (ou **Delete Static Site**). Depois, apague o Blueprint em **Blueprints**.

## 6. Conferir o primeiro deploy

Este passo só vale num deploy do zero, antes do passo 9: depois dele, os endereços `onrender.com` respondem `404`, e a conferência é feita pelo [teste de fumaça](#10-teste-de-fumaça).

Antes do DNS, cada serviço só responde no seu endereço `onrender.com`, mostrado no topo da página do serviço. Por esses endereços, dá para conferir o `/health`, o `/ready` e se o site carrega, mas **não dá para usar o site**: ele chama a API em `https://api-agenda.kaikyjefferson.dev`, que ainda não existe, e o cookie precisa do domínio próprio (veja [Arquitetura](#1-arquitetura-de-produção)).

### API

1. Em **agenda-api → Logs**, o deploy deve mostrar, nesta ordem:
   - o build com `uv sync --frozen --no-dev`;
   - as migrações do Alembic (`Running upgrade ...`);
   - o uvicorn no ar;
   - `INFO app.jobs.in_process ... started in the API process`, para o worker e para a restauração;
   - a restauração da demo (`INFO app.jobs.restore_demo demo restored in ...s`).

   As linhas do app saem como `NÍVEL logger mensagem`, sem data, porque o Render já marca a hora de cada linha. Até o PR #34, essas linhas `INFO` não apareciam (veja [Problemas já resolvidos](#12-problemas-já-resolvidos)).
2. Teste o processo e o banco:

   ```bat
   curl -s https://<agenda-api>.onrender.com/health
   curl -s https://<agenda-api>.onrender.com/ready
   curl -s -o NUL -w "%{http_code}\n" https://<agenda-api>.onrender.com/api/v1/public/businesses/barbearia-demo
   ```

   O esperado é `{"status":"ok"}`, depois `{"status":"ok","database":"ok"}` e por fim `200`. A primeira chamada pode levar cerca de um minuto, se a API estiver dormindo.
3. Confira se a API desliga de forma limpa. Em **Manual Deploy → Deploy latest commit**, o log da instância antiga deve terminar com `INFO app.jobs.in_process background tasks stopped` e `Application shutdown complete.`. Isso mostra que o `SIGTERM` chegou ao uvicorn, que o `exec` do `startCommand` põe no lugar do shell (D105, D113). Se o log parar de repente, sem essas linhas, nada se perde, porque a reserva da D38 devolve a mensagem que estava no meio. Mesmo assim, registre o caso para investigar o comando de início.

### Site

Abra `https://<agenda-site>.onrender.com`. A página inicial deve carregar, ainda sem dados da API. Confira os cabeçalhos com um `GET` que mostra só os cabeçalhos:

```bat
curl -s -D - -o NUL https://<agenda-site>.onrender.com/
```

A resposta deve trazer `strict-transport-security`, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy` e `content-security-policy`. Ela **não** deve trazer `cache-control: ... immutable`, que é só de `/assets/*`. Para conferir o cache dos arquivos, copie o caminho de um arquivo de `/assets/` do HTML (`curl -s https://<agenda-site>.onrender.com/`) e rode o mesmo comando nele. A resposta deve ter `cache-control: public, max-age=31536000, immutable`.

**Se der errado:**

- **`alembic: not found` ou `uvicorn: not found`:** o build não criou o `backend/.venv` que o `startCommand` usa (`.venv/bin/alembic`, `.venv/bin/uvicorn`). Confira no log do build se o `uv sync` rodou dentro de `backend/` (`rootDir: backend`).
- **`RESEND_API_KEY is required` ou `DEMO_RESTORE_IN_PROCESS requires a DEMO_PASSWORD`:** um segredo ficou vazio ou curto. Corrija em **Environment**.
- **Erro de conexão nas migrações:** a `DATABASE_URL` está errada. Repita o teste do passo 3 com o valor salvo no Render.
- **Uma migração falhou:** a API não sobe, e o Render mantém a versão anterior no ar (no primeiro deploy, não há nenhuma). Corrija num PR.
- **`/ready` com `503 DATABASE_UNAVAILABLE`:** o Neon está fora do ar ou sem cota de CU-horas. Veja o painel do Neon.
- **O build do site falha com `VITE_API_BASE_URL ...`:** o valor do `render.yaml` não bate com o `connect-src` de `frontend/csp.ts`. O `npm run check:render` acusaria isso antes.

**Como voltar:** veja [Quando algo dá errado](#13-quando-algo-dá-errado).

## 7. Domínio na Cloudflare: DNS, proxy e SSL

### Registros de DNS

Em **DNS → Records** de `kaikyjefferson.dev`, crie os registros abaixo. Os nomes são relativos ao domínio. Os valores vêm do painel do Render (os endereços `onrender.com`) e do Resend (**Domains → mail.kaikyjefferson.dev**). Os valores entre `<...>` são do seu painel; os demais são os da produção, que são públicos.

| Tipo | Nome | Valor | Para que serve |
|---|---|---|---|
| `CNAME` | `agenda` | `<agenda-site>.onrender.com`, sem `https://` | Site |
| `CNAME` | `api-agenda` | `<agenda-api>.onrender.com`, sem `https://` | API |
| `TXT` | `resend._domainkey.mail` | `p=<chave pública mostrada pelo Resend>` | DKIM |
| `CNAME` | `send.mail` | `send.forge.rmta.net` | Return-Path (avisos de devolução) do Resend em São Paulo |
| `CNAME` | `rsend.mail` | `rsend-sae1.forge.rmta.net` | Idem |
| `TXT` | `_dmarc.mail` | `v=DMARC1; p=none;` | DMARC do subdomínio de envio, começando em `p=none` |
| `TXT` | `@` (raiz) | `v=spf1 -all` | A raiz não envia e-mail; ninguém pode usá-la como remetente |
| `TXT` | `_dmarc` | `v=DMARC1; p=reject;` | Idem, para a raiz |

- **Valem os valores do painel do Resend.** Os dois `CNAME` de `send.mail` e `rsend.mail` são os da região São Paulo. Em outra região, ou em domínios mais antigos, o Resend pode pedir um `MX` e um `TXT` em `send.mail` no lugar deles.
- O Resend recomenda o `_dmarc` na raiz com `p=none`. Ficou o `p=reject` da tabela, porque a raiz não envia e-mail.
- **TTL:** **Auto** em todos.
- **Nenhum `AAAA`** em `agenda` e `api-agenda`: o Render usa só IPv4.
- **`CAA`:** só se o passo 0 encontrou algum. Nesse caso, acrescente `0 issue "letsencrypt.org"` e `0 issue "pki.goog"` na raiz, para o Render conseguir emitir o certificado.
- **Nada de `MX` de recebimento:** o Agenda não recebe e-mail.

### Modo do proxy

**Todos os registros ficam como DNS only (nuvem cinza)**, sempre, e não só durante a verificação. Com o proxy ligado (nuvem laranja), a Cloudflare ficaria entre o visitante e o Render e mudaria os cabeçalhos de IP de que os limites dependem (`TRUSTED_CLIENT_IP_HEADER`, D118). O Resend também configura os registros sozinho, pelo botão **Sign in to Cloudflare** da página do domínio. Nesse caso, confira depois se ficaram como DNS only.

### SSL

O certificado HTTPS de `agenda.kaikyjefferson.dev` e de `api-agenda.kaikyjefferson.dev` é **emitido e renovado pelo Render**, que também redireciona HTTP para HTTPS. Como o proxy está desligado, o tráfego não passa pela Cloudflare, e **o modo SSL/TLS da Cloudflare (Off, Flexible, Full...) não tem efeito**: não é preciso mexer nele. O `Strict-Transport-Security` vem dos próprios serviços (o site pelo `render.yaml`, a API pelo middleware da D117).

### Verificar no Render

No Render, em **agenda-site → Settings → Custom Domains**, clique em **Verify** em `agenda.kaikyjefferson.dev`. Faça o mesmo na `agenda-api`, em `api-agenda.kaikyjefferson.dev`. Depois da verificação, o Render emite o certificado.

```bat
nslookup -type=CNAME agenda.kaikyjefferson.dev 1.1.1.1
nslookup -type=CNAME api-agenda.kaikyjefferson.dev 1.1.1.1
curl -s https://api-agenda.kaikyjefferson.dev/health
```

Os dois `nslookup` devem mostrar os endereços `onrender.com`, e não IPs da Cloudflare. O `curl` deve responder `{"status":"ok"}`.

**Se der errado:**

- **O Render não verifica:** confira com os `nslookup` acima que o nome aponta para o endereço `onrender.com` certo e que a nuvem está cinza. A propagação costuma levar minutos.
- **Certificado pendente por muito tempo:** confira se existe um `CAA` na zona que não autoriza `letsencrypt.org` e `pki.goog`.
- **O Render diz que acabaram os domínios incluídos:** o Estoque ou outro projeto já usa algum dos 2 do Hobby. Veja [D107](08-arquitetura.md#domínio-d107) antes de seguir.

**Como voltar:** apague os registros na Cloudflare e os domínios em **Custom Domains**. Os endereços `onrender.com` continuam funcionando, se ainda não foram desligados no passo 9.

## 8. Verificar o domínio no Resend

1. Em **Domains → mail.kaikyjefferson.dev**, clique em **Verify DNS Records**. Os registros de DKIM e do Return-Path ficam **Verified**, e o domínio também.
2. A partir daqui, os e-mails da fila saem de verdade. Antes disso, o Resend recusava o envio com `403`, e a mensagem voltava para a fila com as retentativas da D39: até 5 tentativas, a primeira na hora e as outras 1, 5, 15 e 60 minutos depois da anterior (cerca de 1h20 no total, ou mais se a API dormir no meio). Depois da quinta, ou com mais de 24 horas, a mensagem vira `failed`. Até o PR #34, esse `403` descartava a mensagem na hora (veja [Problemas já resolvidos](#12-problemas-já-resolvidos)).

**Se der errado:**

- **Fica em `Pending`:** espere a propagação e verifique de novo. Confira os nomes: na Cloudflare, o nome é `resend._domainkey.mail`, e não o nome completo com `.kaikyjefferson.dev` repetido.
- **`Failed`:** algum valor foi copiado com espaço ou aspas a mais. Compare caractere por caractere com o painel.

**Como voltar:** apague o domínio no Resend e os registros de e-mail na Cloudflare. A API continua no ar, mas os envios falham, e o site mostra o link na tela quando o e-mail não sai (RN26).

## 9. Desligar os endereços `.onrender.com`

**Feito na produção no PR #33.** Depois que os dois domínios estiverem verificados e funcionando, desligue os endereços `onrender.com` para existir um só endereço de cada serviço (D107). Faça isso num **PR próprio**, que acrescenta a cada serviço do `render.yaml`, logo depois do `domains`:

```yaml
    renderSubdomainPolicy: disabled
```

O Render só aceita esse valor num serviço que já tem domínio próprio. Depois do merge, em **Blueprints → agenda-inteligente**, clique em **Manual Sync**: o Blueprint da produção está em sincronização manual, então o merge sozinho não aplica a mudança. Depois da sincronização, os endereços `onrender.com` passam a responder `404`:

```bat
curl -s -o NUL -w "%{http_code}\n" https://<agenda-api>.onrender.com/health
curl -s -o NUL -w "%{http_code}\n" https://api-agenda.kaikyjefferson.dev/health
```

O primeiro deve dar `404`, e o segundo `200`.

**Se der errado:** se o site ou a API saírem do ar pelo domínio próprio, o problema está no DNS ou no certificado, e não no endereço desligado. Volte ao passo 7.

**Como voltar:** um PR com `renderSubdomainPolicy: enabled`, seguido de **Manual Sync** no Blueprint. Não basta mudar a opção **Render Subdomain** no painel, porque a próxima sincronização do Blueprint a desfaria.

## 10. Teste de fumaça

Rode depois do passo 8, de novo depois do passo 9 e sempre que quiser conferir a produção. Há uma parte rápida com `curl`, um teste automatizado com Playwright e alguns itens que continuam manuais.

### Conferência rápida com `curl`

```bat
curl -s https://api-agenda.kaikyjefferson.dev/health
curl -s https://api-agenda.kaikyjefferson.dev/ready
```

O esperado é `{"status":"ok"}` e `{"status":"ok","database":"ok"}`. O `/health` não consulta o banco, para o Neon poder dormir; o `/ready` consulta (D118). Se a API estiver dormindo, a primeira resposta leva cerca de um minuto. Se o compute do Neon estiver dormindo, o `/ready` também demora alguns segundos a mais.

**Use `curl -s`, que faz um `GET`, como forma principal.** O `curl -I` faz um `HEAD`, que hoje também responde `200` (sem corpo) em `/health` e `/ready`, mas só desde o PR #34: até ali, as duas rotas só aceitavam `GET`, e o `HEAD` dava `405 Method Not Allowed` (veja [Problemas já resolvidos](#12-problemas-já-resolvidos)). Para ver os cabeçalhos com um `GET`:

```bat
curl -s -D - -o NUL https://api-agenda.kaikyjefferson.dev/health
curl -s -D - -o NUL https://agenda.kaikyjefferson.dev/
```

A API deve trazer `strict-transport-security`, `x-content-type-options: nosniff` e `x-frame-options: DENY`. O site deve trazer os cabeçalhos do [passo 6](#site).

### Teste automatizado: `npm run test:smoke`

Na pasta `frontend`:

```bat
cd frontend
npm run test:smoke
```

O teste usa o [`frontend/playwright.smoke.config.ts`](../frontend/playwright.smoke.config.ts) e os arquivos de [`frontend/smoke/`](../frontend/smoke/), e roda contra `https://agenda.kaikyjefferson.dev` e `https://api-agenda.kaikyjefferson.dev`. Ele fica fora da suíte E2E e do CI. Não lê nenhum segredo: o atalho da demo em `/entrar` já traz a senha no JavaScript público do site.

Antes de qualquer teste, o `global-setup.ts` espera o `/health` responder, por até `SMOKE_WARMUP_SECONDS` (padrão `90`), para a API acordar. Os arquivos rodam em ordem, um de cada vez, num Chrome de desktop, em `pt-BR` e no fuso `America/Sao_Paulo`, **sem nenhuma repetição**, porque uma repetição criaria um segundo agendamento.

| Arquivo | Item | O que verifica |
|---|---|---|
| `01-api-e-cabecalhos.smoke.ts` | 1 e 2 | `/health` e `/ready` com `GET`; os cabeçalhos de segurança do site em `/`, `/n/barbearia-demo` e `/entrar`, com a CSP igual à de `frontend/csp.ts` e sem `immutable` no HTML; os cabeçalhos da API; o CORS liberando só o site |
| `02-agendar-e-cancelar.smoke.ts` | 4 e 5 | Um agendamento pela página pública da demo, a tela de sucesso com o link, o link aberto e o cancelamento. Cria 1 agendamento e 2 e-mails por execução e, se um passo falhar, cancela o agendamento pela API no fim |
| `03-equipe.smoke.ts` | 6 e 7 | O Dono entra pelo atalho da demo, recarrega a página sem perder a sessão, o cookie `__Host-refresh_token` tem `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`, e sai; o Profissional vê só a própria agenda |
| `04-duas-abas.smoke.ts` | 8 | Duas abas no mesmo navegador: recarregar as duas juntas mantém as duas logadas; sair numa encerra a outra; a API recusa o cookie antigo. **Pulado por padrão:** a parte que espera o token de acesso expirar |
| `99-limite-de-login.smoke.ts` | 10 | **Pulado por padrão.** 11 logins errados com um e-mail descartável: 10 respostas `401` e `429` na 11ª, com `Retry-After` de até 900 s |
| Todos com navegador | 9 | Qualquer violação de CSP, `Refused to`, erro no console ou erro da página reprova o teste |

Sem nenhuma variável, o resultado esperado é tudo verde, com **2 testes pulados** (`skipped`). Para rodar um arquivo só, por exemplo sem criar agendamento:

```bat
npm run test:smoke -- smoke/03-equipe.smoke.ts
```

O relatório fica em `frontend/playwright-report/smoke`. Em uma falha, os traces ficam em `frontend/test-results/smoke`. Eles contêm o link do agendamento e tokens de sessão da demo. As duas pastas estão no `.gitignore`: não as compartilhe.

### Os 2 testes pulados

Os dois ficam desligados por padrão porque custam tempo ou deixam efeito na produção, e não porque falham:

- **Expiração do token (`SMOKE_LONG=1`):** espera `SMOKE_LONG_MINUTES` (padrão `16`) com as duas abas paradas, além dos 15 minutos de validade do token de acesso, e depois usa as duas: nenhuma pode voltar para `/entrar`, porque só uma renova a sessão e a outra adota o token (D70 a D73). **Por que fica desligado:** a execução leva cerca de 17 minutos a mais.
- **`429` no login (`SMOKE_RATE_LIMIT=1`):** faz 11 logins errados para um e-mail que não existe, gerado a cada execução. **Por que fica desligado:** bloqueia o login **deste IP com esse e-mail** até o fim da janela de 15 minutos, alinhada ao relógio (:00, :15, :30, :45), e as 11 tentativas também contam no limite de 50 logins por IP na mesma janela. As contas da demo continuam entrando, mas rodar o teste várias vezes seguidas da mesma rede pode chegar a esse limite. Ele é o último arquivo da execução, de propósito.

No `cmd`, defina a variável antes do comando e limpe depois:

```bat
cd frontend
set SMOKE_LONG=1
set SMOKE_RATE_LIMIT=1
npm run test:smoke
set SMOKE_LONG=
set SMOKE_RATE_LIMIT=
```

Dá para ligar só um dos dois. Com `SMOKE_RATE_LIMIT=1` e sem `SMOKE_LONG`, a execução continua rápida.

### Itens manuais

Estes itens dependem de uma pessoa ou de outra rede e continuam fora do teste automatizado. Use uma janela anônima do navegador, com o **DevTools aberto na aba Console**.

1. **Partida a frio (item 3):** com a API dormindo (15 minutos sem visitas), abra `https://agenda.kaikyjefferson.dev/n/barbearia-demo`. A faixa "Conectando ao servidor" pode aparecer, e a página carrega sozinha, em até cerca de um minuto (D112).
2. **E-mail real (itens 4 e 5):** rode o teste com o seu e-mail, ou agende pela página da demo:

   ```bat
   set SMOKE_CUSTOMER_EMAIL=<seu e-mail>
   npm run test:smoke -- smoke/02-agendar-e-cancelar.smoke.ts
   set SMOKE_CUSTOMER_EMAIL=
   ```

   Os dois e-mails (confirmação e cancelamento) chegam em poucos segundos, de `nao-responda@mail.kaikyjefferson.dev`. No Gmail, em **Mostrar original**, confira `SPF: PASS`, `DKIM: PASS` e `DMARC: PASS`. Lembre do teto de 3 e-mails por destinatário por dia.
3. **IP certo no limite de login, de outra rede (item 10, D118):** logo depois de rodar o teste com `SMOKE_RATE_LIMIT=1` (ou o comando abaixo) na sua rede Wi-Fi, rode o comando do celular em 4G (ou de um notebook ligado ao 4G). A primeira resposta precisa ser `401`. Se for `429`, todos os visitantes estão sendo contados como um IP só, e o `TRUSTED_CLIENT_IP_HEADER` está errado.

   ```bat
   for /L %i in (1,1,11) do @curl -s -o NUL -w "%{http_code}\n" -X POST https://api-agenda.kaikyjefferson.dev/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"teste-limite@example.com\",\"password\":\"senha-errada-123\"}"
   ```

   Na mesma rede, as 10 primeiras respostas são `401`, e a 11ª é `429`.
4. **Tempo do login (item 11, D112):** no DevTools, aba **Network**, veja quanto o `POST /api/v1/auth/login` levou com a API acordada. Anote o valor. Se passar de alguns segundos, o Argon2id está pesado para a instância grátis, o que é assunto para uma decisão, e não para ajustar no deploy.

**Se der errado:**

- **`[smoke] .../health não respondeu em 90 s`:** a API não acordou a tempo, ou está fora do ar. Rode de novo com `set SMOKE_WARMUP_SECONDS=180` e veja os logs da `agenda-api`.
- **Erro de CORS no Console:** o `CORS_ALLOWED_ORIGINS` não é exatamente `https://agenda.kaikyjefferson.dev`, sem barra no fim.
- **Sai da sessão ao recarregar:** o cookie não está sendo gravado. Confira se o site e a API estão nos domínios próprios, e não num endereço `onrender.com`. Uma resposta `403 ORIGIN_NOT_ALLOWED` no refresh também aponta para o `CORS_ALLOWED_ORIGINS`.
- **Violação de CSP:** a política do `render.yaml` está diferente da que o E2E testou. Rode `npm run check:render` e compare com `frontend/csp.ts`.
- **O e-mail não chega:** veja os logs da API (o worker registra só o tipo do erro, D40) e a aba **Logs** do Resend. Sem domínio verificado (passo 8), o Resend recusa o envio.
- **`429` no 4G no item 10:** ainda não há valor conhecido que funcione melhor que `True-Client-IP`. Abra uma investigação antes de mudar a variável: sem o cabeçalho certo, os limites ficam fracos ou bloqueiam todo mundo.

**Como voltar:** cada falha aponta para um passo anterior. Para tirar o projeto do ar enquanto investiga, veja [Suspender](#suspender-os-serviços).

## 11. Limitações do plano gratuito

Tudo roda em planos gratuitos, sem forma de pagamento cadastrada. Os limites foram conferidos na documentação oficial em novembro de 2026 e mudam com frequência.

| Serviço | Limitação | Efeito no Agenda |
|---|---|---|
| Render, Web Service grátis | **A API dorme depois de 15 minutos sem requisições** e leva cerca de um minuto para acordar | A primeira visita depois de um tempo parado demora. O site aquece a API ao abrir e mostra a faixa "Conectando ao servidor" (D112). O teste de fumaça espera até 90 s |
| Render, Web Service grátis | Uma instância, com 512 MB de RAM e 0,1 de CPU | Um processo só (`--workers 1`). O Argon2id é limitado a 2 hashes ao mesmo tempo, e o login é mais lento do que no computador |
| Render, Web Service grátis | Sem background worker, sem cron e sem pre-deploy | O worker de e-mails, a restauração e a limpeza rodam dentro da API (D105, D106), e as migrações rodam no comando de início (D113). Com a API dormindo, nada roda: os e-mails da fila e a restauração esperam a próxima visita |
| Render, Web Service grátis | Portas de SMTP bloqueadas | E-mail só pela API HTTPS do Resend |
| Render, workspace Hobby | 750 horas de instância e 5 GB de banda por mês, e 2 domínios próprios, divididos com o Estoque | Nada pode manter a API acordada: nada de monitor, ping ou cron (D119) |
| Neon grátis | O compute dorme depois de 5 minutos sem uso, e isso não se desliga | O `/ready` e a primeira consulta depois de um tempo parado demoram alguns segundos a mais |
| Neon grátis | 100 CU-horas por mês, 1 GB de armazenamento e 6 horas de histórico para restauração | Compute fixo em 0,25 CU. A limpeza diária apaga contadores e e-mails antigos (D115). Um problema descoberto depois de 6 horas não tem volta pelo Neon |
| Resend grátis | 100 e-mails por dia e 3.000 por mês, **por conta** | `EMAIL_DAILY_CAP=100`, somado a outros projetos da mesma conta. Cada execução do teste de fumaça gasta 2 |

### Conferir o uso todo mês

- **Render**, em **Billing**: as horas grátis do workspace (750, somando o Estoque) e a banda (5 GB).
- **Neon**: as CU-horas (100) e o armazenamento (1 GB).
- **Resend**: os e-mails do mês (3.000).

## 12. Problemas já resolvidos

Problemas encontrados no primeiro deploy (16/11/2026) e corrigidos no PR #34, além do desligamento dos endereços `onrender.com` no PR #33. Ficam aqui para o caso de reaparecerem.

### Logs `INFO` do app não apareciam no Render

- **Sintoma:** no log da `agenda-api`, faltavam `... started in the API process`, `demo restored in ...`, os envios do worker e `background tasks stopped`. Os `WARNING` e `ERROR` saíam sem o nome do logger.
- **Causa:** o uvicorn configura só os próprios loggers (`uvicorn.*`), e o logger raiz do Python ficava sem handler e no nível `WARNING`. Os `INFO` dos loggers `app.*` eram descartados. Só os scripts avulsos chamavam `logging.basicConfig`.
- **Correção:** `configure_app_logging()`, em `backend/app/core/logging.py`, chamada em `backend/app/main.py`. Ela põe um handler só no logger `app`, no `stdout`, com o filtro do link do cliente (D24), sem data na API (o Render já marca a hora) e com data nos scripts. Os scripts passaram a usar a mesma função, e os loggers usam `__spec__.name`, para manter o nome do módulo também com `python -m`.

### Aviso do `VIRTUAL_ENV` a cada partida da API

- **Sintoma:** a cada partida, o `uv run --no-sync` avisava que o `VIRTUAL_ENV` não correspondia ao `.venv` do projeto.
- **Causa:** o runtime Python do Render exporta no `VIRTUAL_ENV` e no `PATH` um ambiente próprio, na raiz do repositório, diferente do `backend/.venv` que o `uv sync` cria. Um `alembic` sem caminho viria desse outro ambiente, vazio.
- **Correção:** o `startCommand` do `render.yaml` passou a chamar os executáveis do ambiente do build pelo caminho: `.venv/bin/alembic upgrade head && exec .venv/bin/uvicorn ...`, sem o uv (D113).

### `HEAD` em `/health` e `/ready` respondia `405`

- **Sintoma:** `curl -I https://api-agenda.kaikyjefferson.dev/health` respondia `405 Method Not Allowed`, embora o `GET` funcionasse.
- **Causa:** as duas rotas só existiam como `GET`, e o FastAPI não responde `HEAD` numa rota `GET`.
- **Correção:** rotas `HEAD` próprias em `backend/app/api/health.py`, fora do OpenAPI. O `HEAD /health` responde `200` sem consultar o banco; o `HEAD /ready` faz a mesma consulta do `GET` e responde `200` ou `503`, sempre sem corpo. A verificação recomendada continua sendo o `curl -s` (passo 10).

### E-mails descartados antes da verificação do domínio

- **Sintoma:** os e-mails enviados antes de o domínio ficar **Verified** no Resend viravam `failed` na hora e nunca saíam, embora o guia dissesse que seriam tentados de novo.
- **Causa:** `classify_http_status`, em `backend/app/domain/email_retry.py`, tratava todo `4xx` menos o `429` como falha permanente. O `403` do Resend para um domínio não verificado, que depende da conta e não da mensagem, descartava o e-mail.
- **Correção:** `401`, `403` e `429` passaram a ser falhas temporárias (`HTTP_RETRIED_CLIENT_ERRORS`), com as retentativas da D39 (cerca de 1h20 no total). Os outros `4xx`, como `400` e `422`, continuam permanentes.

### Risco de estourar a memória com logins simultâneos

- **Sintoma possível:** uma rajada de logins derrubaria a API por falta de memória.
- **Causa:** cada hash Argon2id usa 64 MiB enquanto roda, e o limite padrão de threads do anyio deixava 40 rodarem juntas (cerca de 2,5 GiB) numa instância de 512 MB.
- **Correção:** um `CapacityLimiter` de 2 hashes ao mesmo tempo (`MAX_CONCURRENT_HASHES`, em `backend/app/core/security.py`), compartilhado pelo cadastro e pela conferência de senha. Com 0,1 de CPU, hashes simultâneos só dividiriam o processador, então a fila quase não atrasa o último login.

### Commit na `main` sem deploy

- **Sintoma possível:** dois pushes seguidos na `main` deixariam o primeiro commit sem deploy.
- **Causa:** o CI cancelava a execução anterior a cada push (`cancel-in-progress: true`). Com `autoDeployTrigger: checksPass`, o Render só publica um commit cujas verificações passaram, e uma execução cancelada não passa.
- **Correção:** em `.github/workflows/ci.yml`, o cancelamento passou a valer só em pull requests. Na `main`, toda execução vai até o fim.

### Avisos de fim de linha no Windows

- **Sintoma:** avisos "LF will be replaced by CRLF" e diffs só de fim de linha.
- **Causa:** `core.autocrlf=true` no Windows, sem regra no repositório.
- **Correção:** o [`.gitattributes`](../.gitattributes), com `* text=auto eol=lf` e os binários marcados.

### Endereços `onrender.com` ainda respondendo

- **Causa:** o Render só aceita `renderSubdomainPolicy: disabled` num serviço com domínio próprio, então o desligamento não podia ir no primeiro `render.yaml`.
- **Correção:** o PR #33, depois de os domínios funcionarem, seguido de **Manual Sync** no Blueprint ([passo 9](#9-desligar-os-endereços-onrendercom)).

## 13. Quando algo dá errado

### Ler os logs

Em **agenda-api → Logs**. As linhas do app começam com o nível e o nome do logger, como `INFO app.jobs.email_worker ...` ou `WARNING app.api.health ...`. Os logs nunca trazem e-mails, tokens nem a URL do banco (D40, D49).

### Voltar a um deploy anterior

Em **agenda-api** (ou **agenda-site**) **→ Events**, escolha o último deploy bom e clique em **Rollback**. O rollback volta o código, mas **não desfaz migrações**. Se o deploy ruim aplicou uma migração, a versão antiga precisa funcionar com o banco novo. Caso contrário, desfaça a migração da sua máquina, com a `DATABASE_URL` do Neon e os segredos de teste do passo 3, antes do rollback:

```bat
cd backend
uv run alembic downgrade -1
```

Depois do rollback, o `autoDeployTrigger` continua ligado, e o próximo commit na `main` publica de novo. Corrija pela `main`.

### Restaurar o banco

O Neon guarda 6 horas de histórico no plano grátis. Em **Branches → production → Restore**, escolha um momento anterior ao problema. Tudo o que foi gravado depois desse momento se perde. A demo se recria sozinha na próxima conferência (D106), ou pela [restauração manual](#14-anexo-restauração-manual-da-demo).

### Suspender os serviços

Em **Settings → Suspend Web Service** (ou **Suspend Static Site**), o serviço sai do ar sem perder a configuração. **Resume** o religa.

### Trocar os segredos

- **`RESEND_API_KEY` vazada:** em **API Keys** no Resend, apague a chave e crie outra (passo 4). Depois, troque o valor em **agenda-api → Environment**.
- **`JWT_SECRET`:** troque em **Environment** por um valor de pelo menos 32 caracteres, por exemplo:

  ```bat
  python -c "import secrets; print(secrets.token_urlsafe(32))"
  ```

  Todas as sessões terminam.
- **`RATE_LIMIT_KEY_SECRET`:** o mesmo procedimento. Os contadores de limite recomeçam.
- **`DEMO_PASSWORD`:** troque nos dois serviços (`DEMO_PASSWORD` e `VITE_DEMO_PASSWORD`), com o mesmo valor. O site precisa de um novo build, e a senha nova só vale depois da próxima restauração; para valer na hora, rode a [restauração manual](#14-anexo-restauração-manual-da-demo).
- **Senha do banco:** em **Roles** no Neon, **Reset password**. Depois, atualize a `DATABASE_URL`.

Salvar uma variável em **Environment** reinicia o serviço com o valor novo.

### Desfazer o deploy inteiro

Apague os dois serviços e o Blueprint no Render, os registros de DNS na Cloudflare, o domínio e a chave no Resend e o projeto no Neon, nessa ordem. O domínio continua seu até expirar; para não renovar, desligue a renovação automática na Cloudflare.

## 14. Anexo: restauração manual da demo

Para emergências: a demo quebrou e não dá para esperar a próxima conferência, ou o `DEMO_PASSWORD` mudou. A restauração manual não confere a data, restaura sempre e espera, pela trava da D45, se a API estiver restaurando ao mesmo tempo.

```bat
cd backend
set "DATABASE_URL=<a DATABASE_URL do Render>"
set "DEMO_PASSWORD=<o DEMO_PASSWORD do Render>"
set JWT_SECRET=somente-restauracao-local-0000000001
set RATE_LIMIT_KEY_SECRET=somente-restauracao-local-0000000002
uv run python -m app.jobs.restore_demo
```

O `JWT_SECRET` e o `RATE_LIMIT_KEY_SECRET` locais só satisfazem a validação da configuração: a restauração não assina tokens nem conta limites. O comando termina com código `0` e linhas com data, como `... INFO app.jobs.restore_demo demo restored in ...s`. Feche o terminal depois. Cada restauração encerra as sessões abertas nas contas da demo (D47).
