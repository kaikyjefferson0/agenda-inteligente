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
| CT47 | Cancelar ou remarcar agendamento em status final, inclusive cancelar duas vezes | `409 INVALID_STATUS_TRANSITION` (D19) | Unidade e integração |
| CT48 | Remarcar depois de o serviço ser desativado | `409`, com o original mantido; cancelar continua permitido (D21) | Unidade e integração |
| CT49 | Consulta pelo link | Não devolve nome, e-mail nem telefone do cliente, e as respostas, inclusive as de erro, levam `Cache-Control: no-store` e `Referrer-Policy: no-referrer` (D17, D22) | Integração |
| CT50 | Requisições às rotas do link | O token não aparece nos logs de acesso (D24) | Integração |

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
| CT51 | Agenda com `to <= from` ou período acima de 31 dias; agenda com agendamentos em vários status | `422` nos dois primeiros casos; a agenda devolve também os cancelados, ordenados por início (D25) | Unidade e integração |
| CT52 | Criação manual sem e-mail e com e-mail | Sem e-mail, nenhum token nem e-mail; com e-mail, o link funciona em `GET /public/appointments/{token}`, e o e-mail é enfileirado (D29) | Integração |
| CT53 | Remarcação pela equipe sobrepondo o próprio horário atual | Aceita, e o link do cliente continua o mesmo (D30) | Integração |
| CT54 | Criação manual com serviço inativo, profissional não apto ou horário com segundos | `422` (D28) | Unidade e integração |
| CT55 | Profissional cria, altera ou marca resultado na agenda de colega; recurso de outro negócio | `403` na agenda de colega; `404` no recurso de outro negócio (D27) | Integração |
| CT56 | Cancelamento e remarcação pela equipe, dentro e acima da cota de e-mail | E-mail enfileirado ao cliente sem o nome dele e sem o link; acima da cota, `email_status = "skipped"` (D31) | Integração |

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
| CT29 | Restauração da demo, com outro negócio que tem agendamentos, usuários, sessões e e-mails pendentes | Negócio, contas, serviços, expediente, bloqueio e agendamentos recriados com datas relativas ao dia atual: nos 7 dias anteriores, `completed`, `no_show` e `cancelled`; de hoje em diante, `confirmed`. As linhas do outro negócio e a fila ficam idênticas (D42, D43) | Unidade e integração |
| CT30 | Worker com falha temporária ou dois workers simultâneos | Reenvia com espera crescente; dois workers não pegam a mesma mensagem | Integração |
| CT32 | Negócio demo tenta alterar campos travados, criar serviço, convidar ou recuperar senha | Alterações e convite recusados com `DEMO_RESTRICTED`; recuperação responde `202`; nenhum e-mail é enfileirado | Integração |
| CT57 | Os 5 templates de e-mail, inclusive com nomes contendo `<script>` | Assunto, texto e HTML sem o nome do cliente, com o horário no fuso do negócio e os nomes escapados no HTML (D37) | Unidade |
| CT58 | Mensagem enviada; mensagem que falha 5 vezes | A enviada fica `sent`, com `sent_at` e `payload` nulo; a que falha fica `failed`, com `last_error` e `payload` nulo (D39) | Integração |
| CT59 | Falha permanente do provedor | `failed` na primeira tentativa, sem retentativa (D39) | Integração |
| CT60 | Mensagem reservada por um worker que caiu | Volta a ser enviada depois que a reserva vence (D38) | Integração |
| CT61 | Mensagem pendente há mais de 24 horas | `failed` com `"expired"`, sem chamar o provedor (D39) | Integração |
| CT62 | Logs do worker e `last_error` | Não contêm o destinatário, o link nem o token (D40) | Integração |
| CT63 | Restauração duas vezes seguidas | Mesmo resultado, com os mesmos IDs (D42, D45) | Integração |
| CT64 | `barbearia-demo` pertencendo a um negócio real, e-mail da demo em uso por outro negócio, dois negócios demo ou `DEMO_PASSWORD` ausente ou inválida | A tarefa falha, e nada é apagado nem criado (D46) | Integração |
| CT65 | Uso da demo depois da restauração | O Dono e o Profissional entram com `DEMO_PASSWORD`; as sessões anteriores deixam de funcionar; a disponibilidade pública do próximo dia com expediente (amanhã, de segunda a sexta) tem horários livres em todos os serviços; a agenda tem agendamentos no passado e no futuro (D43, D44, D47) | Integração |
| CT66 | Duas restaurações simultâneas | Terminam sem erro, com um único conjunto de dados (D45) | Integração |
| CT67 | Mensagens pendentes para a demo e para outros negócios | As da demo viram `failed`, com `"demo_restored"` e `payload` nulo; as de outros negócios ficam intactas (D47) | Integração |

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
| UC11 | CT06, CT07, CT08, CT09, CT22, CT23, CT24, CT27, CT30, CT31, CT36, CT57, E2E01 |
| UC12 | CT11, CT36, CT49, CT50, E2E01 |
| UC13 | CT03, CT12, CT47, CT48, CT49, CT57, E2E01 |
| UC14 | CT10, CT12, CT13, CT14, CT47, CT48, CT49, CT57 |
| UC15 | CT20, CT51, CT55, E2E02 |
| UC16 | CT15, CT16, CT35, CT52, CT54, CT55, CT57 |
| UC17 | CT33, CT34, CT35, CT53, CT55, CT56, CT57 |
| UC18 | CT34, CT55 |
| Transversal | CT19, CT20, CT29, CT58, CT59, CT60, CT61, CT62, CT63, CT64, CT65, CT66, CT67 |
