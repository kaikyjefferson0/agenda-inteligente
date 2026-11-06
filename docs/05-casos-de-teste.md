# 5. Casos de teste

## Estratégia

| Nível | Ferramentas | Foco |
|---|---|---|
| Unidade | pytest | Regras puras, como disponibilidade, prazos e atribuição |
| Integração | pytest, httpx, PostgreSQL em contêiner | Rotas, permissões, transações e restrições do banco |
| Frontend | Vitest, Testing Library | Componentes e formulários |
| Ponta a ponta | Playwright | Fluxos críticos com o sistema completo |

- Os testes de backend usam **PostgreSQL real**. A garantia de nenhum conflito e o comportamento concorrente dependem dele, então SQLite não é usado.
- O tempo é injetado nos testes de regras, para que prazos e fusos sejam determinísticos.
- Nenhum teste chama o provedor de e-mail real.

## Cobertura exigida no CI

O merge é bloqueado abaixo de:

- **90%** nas regras de agendamento.
- **80%** no restante do backend.

## Casos de teste

### Disponibilidade

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT01 | Serviço com preparo não cabe até o fim do expediente | Horário não é oferecido | Unidade |
| CT02 | Horário sobrepõe agendamento, tempo de preparo ou bloqueio | Horário não é oferecido | Unidade |
| CT03 | Agendamento cancelado | Horário volta a ser oferecido | Integração |
| CT04 | Horário fora da antecedência mínima ou máxima | Não é oferecido | Unidade |
| CT05 | Grade calculada em dia de mudança de fuso | Horários seguem o fuso do negócio e ficam corretos em UTC | Unidade |

### Agendamento

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT06 | Duas reservas simultâneas no mesmo horário | Exatamente uma é aceita, e a outra recebe `409` | Integração |
| CT07 | "Sem preferência" | Atribui o apto e livre com menos agendamentos no dia; empate determinístico | Unidade |
| CT08 | Profissional escolhido não atende o serviço | Recusado | Integração |
| CT09 | Falha no envio de e-mail | Agendamento é mantido, e a falha fica registrada | Integração |
| CT10 | Serviço alterado depois da reserva | Agendamento mantém duração, preparo e preço, inclusive ao remarcar | Integração |
| CT23 | Mesma `Idempotency-Key` com os mesmos dados, com o e-mail de criação enfileirado | Devolve o mesmo agendamento, sem criar outro e sem o link | Integração |
| CT24 | Mesma `Idempotency-Key` com dados diferentes | Recusado com `IDEMPOTENCY_KEY_REUSED` | Integração |
| CT31 | Bloqueio e reserva simultâneos no mesmo horário | Apenas um é aceito | Integração |
| CT36 | Mesma `Idempotency-Key` com os mesmos dados, depois de o limite de e-mail impedir o envio na criação | Devolve o mesmo agendamento, sem criar outro, com novo link; o link anterior retorna `404`, e nenhum e-mail é enfileirado | Integração |

### Link do cliente

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT11 | Token inválido, adulterado ou expirado | `404`, sem revelar se o agendamento existe | Integração |
| CT12 | Cancelar ou remarcar antes do prazo, no limite exato e depois dele | Aceito, aceito e recusado | Unidade e integração |
| CT13 | Remarcar para horário ocupado | Recusado, e o horário original continua válido | Integração |
| CT14 | Remarcar para horário livre | Troca atômica, e o horário antigo é liberado | Integração |

### Equipe

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT15 | Criação manual fora da antecedência | Aceita | Integração |
| CT16 | Criação manual sobre outro horário | Recusada | Integração |
| CT17 | Bloqueio sobre agendamento confirmado | Recusado, com a lista de conflitos | Integração |
| CT18 | Desativar profissional com agendamentos futuros | Recusado até que sejam resolvidos | Integração |
| CT25 | Expediente ou fuso alterado deixa agendamentos de fora | Aceito; agendamentos mantidos e listados na resposta | Integração |
| CT33 | Equipe altera agendamento depois do prazo do cliente | Aceito | Integração |
| CT34 | Marcar resultado antes do início ou alterar status final | Recusado | Unidade e integração |
| CT35 | Criação ou remarcação pela equipe fora do expediente ou no passado | Recusada com `SLOT_UNAVAILABLE` | Integração |

### Segurança

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT19 | Usuário acessa recurso de outro negócio pelo ID | `404` em todas as rotas de leitura e escrita | Integração |
| CT20 | Profissional acessa agenda de colega ou rota do Dono | `403` | Integração |
| CT21 | Link de convite ou recuperação reutilizado ou expirado | Recusado | Integração |
| CT22 | Excesso de requisições ao agendamento público | `429`, sem novos e-mails | Integração |
| CT28 | Refresh token reutilizado | Toda a família de tokens é revogada | Integração |
| CT37 | Login com e-mail inexistente, senha errada, conta desativada ou convite não aceito | Status, corpo e cabeçalhos idênticos, e a senha é verificada nos quatro casos | Integração |
| CT38 | Duas renovações simultâneas com o mesmo refresh | Apenas uma é aceita, e a família é revogada | Integração |
| CT39 | Recuperação com e-mail inexistente, conta desativada, convite pendente ou conta válida | Mesma resposta `202`; só a conta válida enfileira e-mail | Integração |
| CT40 | Redefinição de senha | Todas as sessões são revogadas, inclusive os tokens de acesso já emitidos | Integração |
| CT41 | Excesso de tentativas de login, todas com falha | `429` com `Retry-After`; a contagem sobrevive ao rollback e não guarda IP nem e-mail em claro | Integração |
| CT42 | `/auth/refresh` ou `/auth/logout` sem `X-Requested-With` | `403`, sem alterar o token | Integração |
| CT43 | Refresh sem uso por 7 dias, e sessão em uso até 30 dias depois do login | Recusado nos dois limites exatos; antes deles, a validade desliza até o limite absoluto (RN31) | Unidade e integração |
| CT44 | Convite e sessão entre negócios: `business_id` enviado, e-mail pendente de outro negócio e token com a família de outro usuário | Negócio vem da sessão; nada é alterado no outro negócio; pedido recusado | Integração |
| CT45 | Dados inválidos, inclusive senha fora da política | `422` em RFC 9457, sem ecoar a senha | Integração |
| CT46 | Dois aceites simultâneos do mesmo convite | Apenas um é aceito | Integração |

### E-mail e demo

| ID | Cenário | Resultado esperado | Nível |
|---|---|---|---|
| CT26 | Cadastro com `REGISTRATION_ENABLED=false` | `403`, sem criar dados | Integração |
| CT27 | Limite por destinatário ou teto diário atingido | Agendamento é mantido, nada é enfileirado, e o link é devolvido | Integração |
| CT29 | Restauração da demo | Dados demo recriados com datas atuais; outros negócios intactos | Integração |
| CT30 | Worker com falha temporária ou dois workers simultâneos | Reenvia com espera crescente; dois workers não pegam a mesma mensagem | Integração |
| CT32 | Negócio demo tenta alterar campos travados, criar serviço, convidar ou recuperar senha | Alterações e convite recusados com `DEMO_RESTRICTED`; recuperação responde `202`; nenhum e-mail é enfileirado | Integração |

## Ponta a ponta

| ID | Fluxo |
|---|---|
| E2E01 | Cliente agenda na página pública, abre o link e cancela; o horário volta a ficar livre |
| E2E02 | Usuário faz login e vê a agenda |

Os testes usam um adaptador falso de e-mail, nunca o provedor real.

## Rastreabilidade

Validações simples e operações de CRUD de cada caso de uso são testadas em integração, além dos cenários abaixo.

| Caso de uso | Casos de teste |
|---|---|
| UC01 | CT26, CT45 |
| UC02 | CT28, CT37, CT38, CT41, CT42, CT43, E2E02 |
| UC03 | CT21, CT32, CT39, CT40, CT45 |
| UC04 | CT18, CT21, CT32, CT44, CT45, CT46 |
| UC05 | CT19, CT20, CT25, CT32 |
| UC06 | CT10, CT32 |
| UC07 | CT08 |
| UC08 | CT25 |
| UC09 | CT17, CT31 |
| UC10 | CT01, CT02, CT03, CT04, CT05 |
| UC11 | CT06, CT07, CT08, CT09, CT22, CT23, CT24, CT27, CT30, CT31, CT36, E2E01 |
| UC12 | CT11, E2E01 |
| UC13 | CT03, CT12, E2E01 |
| UC14 | CT10, CT12, CT13, CT14 |
| UC15 | CT20, E2E02 |
| UC16 | CT15, CT16, CT35 |
| UC17 | CT33, CT34, CT35 |
| UC18 | CT34 |
| Transversal | CT19, CT20, CT29 |
