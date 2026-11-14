# Deploy

O passo a passo para pôr o Agenda Inteligente no ar. O site fica no Render (Static Site), a API também (Web Service grátis), o banco no Neon e os e-mails pelo Resend, com o domínio `kaikyjefferson.dev`. As decisões são a D105 a D119 do [registro](README.md#pontos-a-revisar), e o motivo de cada escolha está em [Produção](08-arquitetura.md#produção). A configuração dos dois serviços está em [`render.yaml`](../render.yaml).

Siga os passos na ordem. Cada passo traz um **Se der errado** e um **Como voltar**. Os recursos gerais, que valem para qualquer passo, estão em [Quando algo dá errado](#12-quando-algo-dá-errado).

Os comandos são para o terminal `cmd` do Windows. O `curl` já vem no Windows 10 e 11. Onde aparecer `<...>`, troque pelo valor do painel.

## Sumário

0. [Antes de começar](#0-antes-de-começar)
1. [Variáveis de produção](#1-variáveis-de-produção)
2. [Comprar o domínio](#2-comprar-o-domínio)
3. [Criar o banco no Neon](#3-criar-o-banco-no-neon)
4. [Preparar os segredos](#4-preparar-os-segredos)
5. [Criar os serviços pelo Blueprint](#5-criar-os-serviços-pelo-blueprint)
6. [Conferir o primeiro deploy](#6-conferir-o-primeiro-deploy)
7. [DNS na Cloudflare](#7-dns-na-cloudflare)
8. [Verificar o domínio no Resend](#8-verificar-o-domínio-no-resend)
9. [Desligar os endereços `.onrender.com`](#9-desligar-os-endereços-onrendercom)
10. [Teste de fumaça](#10-teste-de-fumaça)
11. [Depois do primeiro mês](#11-depois-do-primeiro-mês)
12. [Quando algo dá errado](#12-quando-algo-dá-errado)
13. [Anexo: restauração manual da demo](#13-anexo-restauração-manual-da-demo)

## 0. Antes de começar

- **Contas:** Cloudflare (registro e DNS do domínio), Neon, Resend e Render. Use o mesmo workspace do Render em que já está o Estoque, no plano Hobby. As 750 horas, os 5 GB de banda e os 2 domínios incluídos são divididos entre os dois projetos (D119). Não cadastre forma de pagamento: sem ela, passar de um limite suspende os serviços em vez de cobrar.
- **No computador:** `python` e `uv`, para o teste da URL do banco e a restauração manual da demo.
- **No repositório:** este PR precisa estar na `main`, porque o Render lê o `render.yaml` da branch escolhida.
- **O que já está no código:** o worker de e-mails e a restauração da demo dentro da API (D105, D106), a limpeza diária (D115), o cookie `__Host-refresh_token` (D108), a conferência do `Origin` (D110), os cabeçalhos de segurança da API (D117), o `/health` sem banco e o `/ready` (D118), o aquecimento da API e o aviso de partida a frio no site (D112).
- **Conferência da CSP:** `npm run check:render`, na pasta `frontend`, confere se a CSP do `render.yaml` é igual à de `frontend/csp.ts`. O CI roda a mesma conferência. Para mudar a CSP, mude os dois arquivos no mesmo commit.

## 1. Variáveis de produção

Os valores fixos já estão no `render.yaml`. Você só preenche os segredos marcados com `sync: false`, que o Render pede uma vez, na criação do Blueprint (passo 5). Nenhum valor real fica no repositório.

**Origem do valor:**

- **Fixa:** escrita no `render.yaml`, e muda por commit.
- **Gerada pelo Render:** `generateValue: true`, um valor aleatório de 256 bits em base64, com 44 caracteres.
- **Você preenche:** só no painel. Neon, Resend ou gerada por você.

### API (`agenda-api`)

| Variável | O que faz | Origem do valor |
|---|---|---|
| `PYTHON_VERSION` | Versão do Python no build e na execução, `3.14.10`, a mesma do `backend/Dockerfile` | Fixa |
| `UV_VERSION` | Versão do uv que o Render instala, `0.13.7` | Fixa |
| `PORT` | Porta em que o uvicorn escuta (`--port $PORT`) | Definida pelo Render (padrão `10000`); não declare |
| `DATABASE_URL` | Conexão com o banco, pela conexão direta, sem `-pooler` (D115). Usada pelas migrações do comando de início, pela API e pelo worker | **Neon**, convertida no passo 3. `sync: false` |
| `JWT_SECRET` | Assina os tokens de acesso. Trocar encerra todas as sessões | Gerada pelo Render |
| `RATE_LIMIT_KEY_SECRET` | Chave do HMAC que esconde o IP e o e-mail nos contadores de limite. Trocar zera os contadores | Gerada pelo Render |
| `REGISTRATION_ENABLED` | Cadastro de novos negócios: `false`. A demo pública não aceita cadastro | Fixa |
| `CORS_ALLOWED_ORIGINS` | A única origem do CORS e a lista do `Origin` conferido no refresh e no logout (D109, D110): `https://agenda.kaikyjefferson.dev` | Fixa |
| `FRONTEND_BASE_URL` | Base dos links nos e-mails: `https://agenda.kaikyjefferson.dev` | Fixa |
| `TRUSTED_CLIENT_IP_HEADER` | Cabeçalho que traz o IP do visitante para os limites: `True-Client-IP` (D118) | Fixa; conferida no passo 10 |
| `EMAIL_BACKEND` | `resend`. A API não sobe sem a `RESEND_API_KEY` | Fixa |
| `EMAIL_FROM` | Remetente: `Agenda Inteligente <nao-responda@mail.kaikyjefferson.dev>` (D111) | Fixa |
| `RESEND_API_KEY` | Chave da API do Resend, só com permissão de envio | **Resend**, passo 4. `sync: false` |
| `EMAIL_DAILY_CAP` | Teto diário de e-mails, `100`. O limite do Resend grátis é por conta: somado aos outros projetos da mesma conta, não passa de 100 | Fixa |
| `EMAIL_RECIPIENT_DAILY_CAP` | E-mails por destinatário por dia, `3` | Fixa |
| `EMAIL_WORKER_IN_PROCESS` | `true`: a API envia a fila de e-mails (D105) | Fixa |
| `DEMO_RESTORE_IN_PROCESS` | `true`: a API restaura a demo uma vez por dia, depois das 03:00 de `America/Sao_Paulo` (D106). Ligada, a API não sobe sem um `DEMO_PASSWORD` válido | Fixa |
| `DEMO_PASSWORD` | Senha das contas `dono@demo.example.com` e `profissional@demo.example.com`, de 12 a 128 caracteres. Vale a partir da próxima restauração | **Gerada por você**, passo 4. `sync: false` |

`SMTP_HOST` e `SMTP_PORT` não entram, porque só valem com `EMAIL_BACKEND=smtp`. O Render bloqueia as portas de SMTP no plano grátis.

### Build do site (`agenda-site`)

Todas são lidas no `npm run build`, então mudar qualquer uma exige um novo deploy do site. Toda variável `VITE_` vai para o JavaScript público.

| Variável | O que faz | Origem do valor |
|---|---|---|
| `NODE_VERSION` | Versão do Node no build, `24.22.2`, a mesma do `frontend/Dockerfile` | Fixa |
| `VITE_API_BASE_URL` | Origem da API: `https://api-agenda.kaikyjefferson.dev`, sem caminho nem barra no fim. O build falha se ela não estiver no `connect-src` da CSP | Fixa |
| `VITE_DEMO_PASSWORD` | Senha do atalho "Conhecer pela demonstração" em `/entrar` (D75). Igual ao `DEMO_PASSWORD` | **Gerada por você**, a mesma do `DEMO_PASSWORD`. `sync: false` |

`VITE_API_PROXY_TARGET` e `VITE_USE_POLLING` só existem no desenvolvimento.

## 2. Comprar o domínio

1. Na Cloudflare, em **Domain Registration → Register Domains**, procure `kaikyjefferson.dev` e compre por 1 ano, com renovação automática ligada. O domínio já fica com o DNS da Cloudflare.
2. Em **DNS → Records**, confira que a zona está vazia ou só tem registros que você reconhece. Anote se existe algum `CAA`, que importa no passo 7.

**Se der errado:**

- **Domínio indisponível ou preço muito diferente do previsto** (cerca de US$ 12 por ano na renovação): pare aqui. Nada no código depende da compra, mas os nomes estão no `render.yaml`, em `frontend/csp.ts` e nas decisões D107 a D117. Com outro domínio, todos mudam num PR antes de seguir.
- **Pagamento recusado:** o cartão precisa aceitar compra internacional em dólar.

**Como voltar:** a Cloudflare não devolve o valor de um registro. Desligue a renovação automática para o domínio expirar em 1 ano.

## 3. Criar o banco no Neon

1. **New Project**:
   - **Nome:** `agenda-inteligente`.
   - **Região:** AWS `us-east-1` (N. Virginia), ao lado da API.
   - **Postgres:** a versão 18, a mesma do CI, se estiver disponível; senão, a mais nova oferecida.
2. Em **Compute**, deixe o mínimo e o máximo em **0,25 CU** (compute fixo, D115). O Neon dorme depois de 5 minutos sem uso, e isso não se desliga no plano grátis.
3. Em **Connect**, com o branch `main`, **desligue "Connection pooling"**. O host não pode ter `-pooler`: as migrações e a trava da restauração não funcionam pelo pooler. Copie a URL. Ela tem este formato:

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

## 4. Preparar os segredos

Este passo vem antes do Render porque o Blueprint pede os valores `sync: false` na criação, e a API não sobe com `EMAIL_BACKEND=resend` sem a chave.

### Senha da demo

```bat
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

O comando imprime 32 caracteres, dentro dos 12 a 128 exigidos. Esse mesmo valor vai no `DEMO_PASSWORD` e no `VITE_DEMO_PASSWORD`. Ele é público de propósito, porque vai no JavaScript do site (D75), e a RN28 trava o que a demo pode fazer. Nunca o reaproveite em outra conta.

### Domínio e chave no Resend

1. Em **Domains → Add Domain**, adicione `mail.kaikyjefferson.dev`, o subdomínio só para envio (D111), e não a raiz. Qualquer região serve; o registro `MX` do passo 7 muda conforme ela. O Resend mostra os registros de DNS, que você cria no passo 7.
2. Em **API Keys → Create API Key**:
   - **Permission:** **Sending access**.
   - **Domain:** só `mail.kaikyjefferson.dev`.
   - **Nome:** `agenda-render`.
3. Copie a chave (`re_...`) e guarde no gerenciador de senhas até o passo 5. O Resend não a mostra de novo.

**Se der errado:** se a chave se perder antes do passo 5, apague-a e crie outra.

**Como voltar:** apague a chave em **API Keys** e o domínio em **Domains**.

## 5. Criar os serviços pelo Blueprint

1. No Render, **New → Blueprint**. Escolha o repositório `agenda-inteligente`, a branch `main` e o nome `agenda-inteligente`. O Render lê o `render.yaml` e lista os dois serviços, `agenda-api` e `agenda-site`.
2. Preencha os segredos que o painel pede:
   - `DATABASE_URL`: a URL convertida no passo 3.
   - `RESEND_API_KEY`: a chave do passo 4.
   - `DEMO_PASSWORD`: a senha do passo 4.
   - `VITE_DEMO_PASSWORD`: a mesma senha.

   `JWT_SECRET` e `RATE_LIMIT_KEY_SECRET` o Render gera sozinho. Os valores `sync: false` só são pedidos agora: uma sincronização posterior do Blueprint nunca os pede de novo nem os sobrescreve.
3. **Apply.** O Render cria os dois serviços e faz o primeiro deploy de cada um. Ele também cadastra os domínios do campo `domains`, que ficam como não verificados até o passo 7.

Depois disso, cada commit na `main` só é publicado quando o CI passa (`autoDeployTrigger: checksPass`).

**Se der errado:**

- **O Render recusa o `render.yaml`:** a mensagem diz o campo. Corrija num PR e crie o Blueprint de novo.
- **Um segredo foi preenchido errado:** corrija em **agenda-api → Environment** (ou no site) e salve com **Save, rebuild, and deploy**. Para o `VITE_DEMO_PASSWORD`, o site precisa de um novo build.

**Como voltar:** apague os dois serviços em **Settings → Delete Web Service** (ou **Delete Static Site**). Depois, apague o Blueprint em **Blueprints**.

## 6. Conferir o primeiro deploy

Antes do DNS, cada serviço só responde no seu endereço `onrender.com`, mostrado no topo da página do serviço. Por esses endereços, dá para conferir o `/health`, o `/ready` e se o site carrega, mas **não dá para usar o site**. O site chama a API em `https://api-agenda.kaikyjefferson.dev`, que ainda não existe, e o CORS só libera `https://agenda.kaikyjefferson.dev`. Mesmo com outro endereço de API, o login não se manteria: dois endereços `*.onrender.com` são sites diferentes para o navegador (o `onrender.com` está na Public Suffix List), e o cookie `__Host-refresh_token`, `SameSite=Strict`, não iria do site para a API. O cookie precisa do domínio próprio, em que o site e a API são o mesmo site (D108).

### API

1. Em **agenda-api → Logs**, o deploy deve mostrar, nesta ordem:
   - o build com `uv sync --frozen --no-dev`;
   - as migrações do Alembic (`Running upgrade ...`);
   - o uvicorn no ar;
   - `... started in the API process` para o worker e para a restauração;
   - a restauração da demo (`demo restored in ...s`).
2. Teste o processo e o banco:

   ```bat
   curl https://<agenda-api>.onrender.com/health
   curl https://<agenda-api>.onrender.com/ready
   curl -o NUL -w "%{http_code}\n" https://<agenda-api>.onrender.com/api/v1/public/businesses/barbearia-demo
   ```

   O esperado é `{"status":"ok"}`, depois `{"status":"ok","database":"ok"}` e por fim `200`. A primeira chamada pode levar cerca de um minuto, se a API estiver dormindo.
3. Confira se a API desliga de forma limpa. Em **Manual Deploy → Deploy latest commit**, o log da instância antiga deve terminar com `background tasks stopped` e `Application shutdown complete.`. Isso mostra que o `uv run` repassou o `SIGTERM` ao uvicorn (D105, D113). Se o log parar de repente, sem essas linhas, nada se perde, porque a reserva da D38 devolve a mensagem que estava no meio. Mesmo assim, registre o caso para trocar o comando de início.

### Site

Abra `https://<agenda-site>.onrender.com`. A página inicial deve carregar, ainda sem dados da API. Confira os cabeçalhos:

```bat
curl -sI https://<agenda-site>.onrender.com/
```

A resposta deve trazer `strict-transport-security`, `x-content-type-options`, `x-frame-options`, `referrer-policy`, `permissions-policy` e `content-security-policy`. Ela **não** deve trazer `cache-control: ... immutable`, que é só de `/assets/*`. Para conferir o cache dos arquivos, copie o caminho de um arquivo de `/assets/` do HTML (`curl -s https://<agenda-site>.onrender.com/`) e rode `curl -sI` nele. A resposta deve ter `cache-control: public, max-age=31536000, immutable`.

**Se der errado:**

- **`alembic: command not found` ou `uvicorn: command not found`:** o build não instalou o ambiente que o `uv run --no-sync` usa. Confira no log do build se o `uv sync` rodou dentro de `backend/`.
- **`RESEND_API_KEY is required` ou `DEMO_RESTORE_IN_PROCESS requires a DEMO_PASSWORD`:** um segredo ficou vazio ou curto. Corrija em **Environment**.
- **Erro de conexão nas migrações:** a `DATABASE_URL` está errada. Repita o teste do passo 3 com o valor salvo no Render.
- **Uma migração falhou:** a API não sobe, e o Render mantém a versão anterior no ar (no primeiro deploy, não há nenhuma). Corrija num PR.
- **`/ready` com `503 DATABASE_UNAVAILABLE`:** o Neon está fora do ar ou sem cota de CU-horas. Veja o painel do Neon.
- **O build do site falha com `VITE_API_BASE_URL ...`:** o valor do `render.yaml` não bate com o `connect-src` de `frontend/csp.ts`. O `npm run check:render` acusaria isso antes.

**Como voltar:** veja [Quando algo dá errado](#12-quando-algo-dá-errado).

## 7. DNS na Cloudflare

Em **DNS → Records** de `kaikyjefferson.dev`, crie os registros abaixo, **todos como DNS only** (nuvem cinza). Os nomes são relativos ao domínio. Os valores vêm do painel do Render (os endereços `onrender.com`) e do Resend (**Domains → mail.kaikyjefferson.dev**).

| Tipo | Nome | Valor | Para que serve |
|---|---|---|---|
| `CNAME` | `agenda` | endereço `onrender.com` do `agenda-site`, sem `https://` | Site |
| `CNAME` | `api-agenda` | endereço `onrender.com` da `agenda-api`, sem `https://` | API |
| `TXT` | `resend._domainkey.mail` | a chave `p=...` mostrada pelo Resend | DKIM |
| `MX` | `send.mail` | `feedback-smtp.<região>.amazonses.com`, prioridade `10` | Return-Path (avisos de devolução); não é caixa de entrada |
| `TXT` | `send.mail` | `v=spf1 include:amazonses.com ~all` | SPF do Return-Path |
| `TXT` | `_dmarc.mail` | `v=DMARC1; p=none;` | DMARC do subdomínio de envio, começando em `p=none` |
| `TXT` | `@` (raiz) | `v=spf1 -all` | A raiz não envia e-mail; ninguém pode usá-la como remetente |
| `TXT` | `_dmarc` | `v=DMARC1; p=reject;` | Idem, para a raiz |

- **Valem os valores do painel do Resend.** Se ele mostrar dois `CNAME` em `send.mail` no lugar do `MX` e do `TXT` (domínios criados depois de agosto de 2026), crie esses.
- O Resend também configura sozinho, pelo botão **Sign in to Cloudflare** da página do domínio. Depois, confira se os registros ficaram como DNS only.
- **Nenhum `AAAA`** em `agenda` e `api-agenda`: o Render usa só IPv4.
- **`CAA`:** só se o passo 2 encontrou algum. Nesse caso, acrescente `0 issue "letsencrypt.org"` e `0 issue "pki.goog"` na raiz, para o Render conseguir emitir o certificado.
- **Nada de `MX` de recebimento:** o Agenda não recebe e-mail.
- **DNS only sempre, e não só durante a verificação:** o proxy da Cloudflare mudaria os cabeçalhos de IP de que os limites dependem (D118).

Depois, no Render, em **agenda-site → Settings → Custom Domains**, clique em **Verify** em `agenda.kaikyjefferson.dev`. Faça o mesmo na `agenda-api`, em `api-agenda.kaikyjefferson.dev`. O Render emite o certificado sozinho e redireciona HTTP para HTTPS.

**Se der errado:**

- **O Render não verifica:** confira com `nslookup -type=CNAME agenda.kaikyjefferson.dev 1.1.1.1` que o nome aponta para o endereço `onrender.com` certo e que a nuvem está cinza. A propagação costuma levar minutos.
- **Certificado pendente por muito tempo:** confira se existe um `CAA` na zona que não autoriza `letsencrypt.org` e `pki.goog`.
- **O Render diz que acabaram os domínios incluídos:** o Estoque ou outro projeto já usa algum dos 2 do Hobby. Veja [D107](08-arquitetura.md#domínio-d107) antes de seguir.

**Como voltar:** apague os registros na Cloudflare e os domínios em **Custom Domains**. Os endereços `onrender.com` continuam funcionando.

## 8. Verificar o domínio no Resend

1. Em **Domains → mail.kaikyjefferson.dev**, clique em **Verify DNS Records**. Os registros de DKIM e do Return-Path ficam **Verified**, e o domínio também.
2. A partir daqui, os e-mails da fila saem de verdade. Antes disso, o Resend recusava o envio, e a mensagem voltava para a fila com as retentativas da D39. Uma mensagem com mais de 24 horas expira.

**Se der errado:**

- **Fica em `Pending`:** espere a propagação e verifique de novo. Confira os nomes: na Cloudflare, o nome é `resend._domainkey.mail`, e não o nome completo com `.kaikyjefferson.dev` repetido.
- **`Failed`:** algum valor foi copiado com espaço ou aspas a mais. Compare caractere por caractere com o painel.

**Como voltar:** apague o domínio no Resend e os registros de e-mail na Cloudflare. A API continua no ar, mas os envios falham, e o site mostra o link na tela quando o e-mail não sai (RN26).

## 9. Desligar os endereços `.onrender.com`

Depois que os dois domínios estiverem verificados e funcionando, desligue os endereços `onrender.com` para existir um só endereço de cada serviço (D107). Faça isso num **PR próprio**, que acrescenta a cada serviço do `render.yaml`:

```yaml
    renderSubdomainPolicy: disabled
```

O Render só aceita esse valor num serviço que já tem um domínio próprio. Depois do merge, o Blueprint sincroniza, e os endereços `onrender.com` passam a responder `404`.

**Se der errado:** se o site ou a API saírem do ar pelo domínio próprio, o problema está no DNS ou no certificado, e não no endereço desligado. Volte ao passo 7.

**Como voltar:** um PR com `renderSubdomainPolicy: enabled`. Não basta mudar a opção **Render Subdomain** no painel, porque a próxima sincronização do Blueprint a desfaria.

## 10. Teste de fumaça

Rode depois do passo 8 e de novo depois do passo 9. Use uma janela anônima do navegador, com o **DevTools aberto na aba Console** o tempo todo.

1. **Banco:** `curl https://api-agenda.kaikyjefferson.dev/ready` responde `{"status":"ok","database":"ok"}`.
2. **Cabeçalhos:** `curl -sI https://agenda.kaikyjefferson.dev/` traz os cabeçalhos do passo 6. `curl -sI https://api-agenda.kaikyjefferson.dev/health` traz `strict-transport-security`, `x-content-type-options: nosniff` e `x-frame-options: DENY`.
3. **Partida a frio:** com a API dormindo (15 minutos sem visitas), abra `https://agenda.kaikyjefferson.dev/n/barbearia-demo`. A faixa "Conectando ao servidor" pode aparecer, e a página carrega sozinha, em até cerca de um minuto (D112).
4. **Agendar:** escolha um serviço, um profissional e um horário, e agende com o **seu** e-mail. A tela de sucesso aparece, e o e-mail chega em poucos segundos, de `nao-responda@mail.kaikyjefferson.dev`. No Gmail, em **Mostrar original**, confira `SPF: PASS` e `DKIM: PASS`.
5. **Abrir o link e cancelar:** abra o link do e-mail (`/agendamento/...`). O agendamento aparece; cancele. A tela mostra o cancelamento, e o e-mail de cancelamento chega.
6. **Dono:** em `/entrar`, use o atalho da demo como Dono (`dono@demo.example.com`). O painel abre com a agenda da equipe. Recarregue a página: a sessão continua, o que mostra que o cookie funcionou. No DevTools, em **Application → Cookies → https://api-agenda.kaikyjefferson.dev**, o `__Host-refresh_token` está com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`.
7. **Profissional:** saia, entre como Profissional (`profissional@demo.example.com`) e confira que o painel mostra só a própria agenda.
8. **Duas abas renovando a sessão:** com a sessão aberta, abra o painel numa segunda aba. Recarregue as duas quase ao mesmo tempo: as duas continuam logadas, porque só uma renova e a outra adota o token (D70 a D73). Deixe as duas abertas por mais de 15 minutos, a validade do token de acesso, e use as duas: nenhuma volta para `/entrar`. Saia numa: as duas vão para `/entrar`.
9. **Console sem erros de CSP:** em todas as telas acima, inclusive ao abrir um diálogo e um menu (o Radix cria uma tag `<style>`), o Console não mostra nenhum `Refused to ...` nem `Content Security Policy`. Ele também não mostra nenhum outro erro.
10. **IP certo no limite de login (D118):** o login tem um limite de 10 tentativas por 15 minutos para cada combinação de IP e e-mail. Use um e-mail que não existe, para não afetar as contas da demo:

    ```bat
    for /L %i in (1,1,11) do @curl -s -o NUL -w "%{http_code}\n" -X POST https://api-agenda.kaikyjefferson.dev/api/v1/auth/login -H "Content-Type: application/json" -d "{\"email\":\"teste-limite@example.com\",\"password\":\"senha-errada-123\"}"
    ```

    Na sua rede Wi-Fi, as 10 primeiras respostas são `401`, e a 11ª é `429`. Logo depois, rode o mesmo comando do celular em 4G (ou de um notebook ligado ao 4G): a primeira resposta precisa ser `401`. Se for `429`, todos os visitantes estão sendo contados como um IP só, e o `TRUSTED_CLIENT_IP_HEADER` está errado.
11. **Tempo do login (D112):** no DevTools, aba **Network**, veja quanto o `POST /api/v1/auth/login` levou com a API acordada. Anote o valor. Se passar de alguns segundos, o Argon2id está pesado para a instância grátis, o que é assunto para uma decisão, e não para ajustar no deploy.

**Se der errado:**

- **Erro de CORS no Console:** o `CORS_ALLOWED_ORIGINS` não é exatamente `https://agenda.kaikyjefferson.dev`, sem barra no fim.
- **Sai da sessão ao recarregar:** o cookie não está sendo gravado. Confira se o site e a API estão nos domínios próprios, e não num endereço `onrender.com` (passo 6). Uma resposta `403 ORIGIN_NOT_ALLOWED` no refresh também aponta para o `CORS_ALLOWED_ORIGINS`.
- **Violação de CSP:** a política do `render.yaml` está diferente da que o E2E testou. Rode `npm run check:render` e compare com `frontend/csp.ts`.
- **O e-mail não chega:** veja os logs da API (o worker registra só o tipo do erro, D40) e a aba **Logs** do Resend. Sem domínio verificado (passo 8), o Resend recusa o envio.
- **`429` no 4G no item 10:** ainda não há valor conhecido que funcione melhor que `True-Client-IP`. Abra uma investigação antes de mudar a variável: sem o cabeçalho certo, os limites ficam fracos ou bloqueiam todo mundo.

**Como voltar:** cada falha aponta para um passo anterior. Para tirar o projeto do ar enquanto investiga, veja [Suspender](#suspender-os-serviços).

## 11. Depois do primeiro mês

Confira o uso no painel de cada serviço (D119):

- **Render**, em **Billing**: as horas grátis do workspace (750, somando o Estoque) e a banda (5 GB).
- **Neon**: as CU-horas (100) e o armazenamento (1 GB).
- **Resend**: os e-mails do mês (3.000).

Nenhum serviço deve manter a API acordada: nada de monitor, ping ou cron.

## 12. Quando algo dá errado

### Voltar a um deploy anterior

Em **agenda-api** (ou **agenda-site**) **→ Events**, escolha o último deploy bom e clique em **Rollback**. O rollback volta o código, mas **não desfaz migrações**. Se o deploy ruim aplicou uma migração, a versão antiga precisa funcionar com o banco novo. Caso contrário, desfaça a migração da sua máquina, com a `DATABASE_URL` do Neon e os segredos de teste do passo 3, antes do rollback:

```bat
cd backend
uv run alembic downgrade -1
```

Depois do rollback, o `autoDeployTrigger` continua ligado, e o próximo commit na `main` publica de novo. Corrija pela `main`.

### Restaurar o banco

O Neon guarda 6 horas de histórico no plano grátis. Em **Branches → main → Restore**, escolha um momento anterior ao problema. Tudo o que foi gravado depois desse momento se perde. A demo se recria sozinha na próxima conferência (D106), ou pela [restauração manual](#13-anexo-restauração-manual-da-demo).

### Suspender os serviços

Em **Settings → Suspend Web Service** (ou **Suspend Static Site**), o serviço sai do ar sem perder a configuração. **Resume** o religa.

### Trocar os segredos

- **`RESEND_API_KEY` vazada:** em **API Keys** no Resend, apague a chave e crie outra (passo 4). Depois, troque o valor em **agenda-api → Environment**.
- **`JWT_SECRET`:** troque em **Environment** por um valor de pelo menos 32 caracteres, por exemplo `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Todas as sessões terminam.
- **`RATE_LIMIT_KEY_SECRET`:** o mesmo procedimento. Os contadores de limite recomeçam.
- **`DEMO_PASSWORD`:** troque nos dois serviços, com o mesmo valor. O site precisa de um novo build, e a senha nova só vale depois da próxima restauração; para valer na hora, rode a [restauração manual](#13-anexo-restauração-manual-da-demo).
- **Senha do banco:** em **Roles** no Neon, **Reset password**. Depois, atualize a `DATABASE_URL`.

Salvar uma variável em **Environment** reinicia o serviço com o valor novo.

### Desfazer o deploy inteiro

Apague os dois serviços e o Blueprint no Render, os registros de DNS na Cloudflare, o domínio e a chave no Resend e o projeto no Neon, nessa ordem. O domínio continua seu até expirar.

## 13. Anexo: restauração manual da demo

Para emergências: a demo quebrou e não dá para esperar a próxima conferência, ou o `DEMO_PASSWORD` mudou. A restauração manual não confere a data, restaura sempre e espera, pela trava da D45, se a API estiver restaurando ao mesmo tempo.

```bat
cd backend
set "DATABASE_URL=<a DATABASE_URL do Render>"
set "DEMO_PASSWORD=<o DEMO_PASSWORD do Render>"
set JWT_SECRET=somente-restauracao-local-0000000001
set RATE_LIMIT_KEY_SECRET=somente-restauracao-local-0000000002
uv run python -m app.jobs.restore_demo
```

O `JWT_SECRET` e o `RATE_LIMIT_KEY_SECRET` locais só satisfazem a validação da configuração: a restauração não assina tokens nem conta limites. O comando termina com código `0` e o log `demo restored in ...s`. Feche o terminal depois. Cada restauração encerra as sessões abertas nas contas da demo (D47).
