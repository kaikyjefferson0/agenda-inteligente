# Teste de fumaça da produção

Automatiza o passo 10 do [guia de deploy](../../docs/deploy.md#10-teste-de-fumaça) contra o site e a API publicados. Fica fora da suíte e2e (`npm run test:e2e` só lê `e2e/`) e fora do CI.

## Como rodar

Na pasta `frontend`:

```bat
npm run test:smoke
```

Por padrão, roda contra `https://agenda.kaikyjefferson.dev` e `https://api-agenda.kaikyjefferson.dev`. Não lê nenhum segredo: o atalho da demo em `/entrar` já traz a senha no JavaScript público do site.

| Variável | Para quê |
|---|---|
| `SMOKE_BASE_URL` / `SMOKE_API_URL` | Outro site e outra API. A API precisa ser a mesma do `VITE_API_BASE_URL` do build do site |
| `SMOKE_WARMUP_SECONDS` | Quanto esperar o `/health` antes de começar, para a API acordar. Padrão: `90` |
| `SMOKE_CUSTOMER_EMAIL` | E-mail do cliente no agendamento. Padrão: `delivered+smoke-<horário>@resend.dev`, um endereço de teste do Resend, que não chega a nenhuma caixa |
| `SMOKE_LONG=1` | Liga a parte do item 8 que espera o token de acesso expirar (`SMOKE_LONG_MINUTES`, padrão `16`). Leva cerca de 17 minutos |
| `SMOKE_RATE_LIMIT=1` | Liga o item 10. Bloqueia por até 15 minutos o login **deste IP com um e-mail descartável**. As contas da demo continuam entrando |

No `cmd`, defina a variável antes do comando:

```bat
set SMOKE_RATE_LIMIT=1
npm run test:smoke
set SMOKE_RATE_LIMIT=
```

Para rodar um arquivo só, por exemplo sem criar agendamento: `npm run test:smoke -- smoke/03-equipe.smoke.ts`.

## O que cobre

- **Itens 1 e 2:** `/health`, `/ready` e os cabeçalhos do site e da API, com `GET`, que traz o corpo. Desde o PR #34, a API também responde `200` ao `HEAD` em `/health` e `/ready`.
- **Itens 4 e 5:** um agendamento pela página pública, a tela de sucesso com o link, o link aberto e o cancelamento. Cria 1 agendamento e 2 e-mails por execução, e nunca tenta de novo. Se um passo falhar, o agendamento é cancelado pela API no fim.
- **Itens 6 e 7:** Dono pelo atalho da demo, recarregar sem perder a sessão, atributos do cookie `__Host-refresh_token`, sair; Profissional vendo só a própria agenda.
- **Item 8:** duas abas no mesmo navegador. Sair numa encerra a outra, e a API recusa o cookie antigo.
- **Item 9:** em todos os testes com navegador, qualquer `Refused to`, `Content Security Policy`, erro no console ou erro da página reprova o teste.
- **Item 10:** só a rede atual. 10 respostas `401` e `429` na 11ª tentativa.

Os itens 3 (só com `SMOKE_LONG`), 11 e as conferências de e-mail continuam manuais. Veja o guia.

Relatório: `playwright-report/smoke`. Em uma falha, os traces ficam em `test-results/smoke`. Eles contêm o link do agendamento e tokens de sessão da demo, e as duas pastas estão no `.gitignore`.
