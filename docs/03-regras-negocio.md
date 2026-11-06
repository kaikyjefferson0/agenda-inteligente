# 3. Regras de negócio

## Grade e disponibilidade

- **RN01. Passo da grade:** cada negócio escolhe o intervalo entre horários de início: 5, 10, 15, 20, 30 ou 60 minutos. O padrão é 15.
- **RN02. Alinhamento:** os horários são múltiplos do passo contados a partir da meia-noite local. Com passo de 15 minutos e expediente a partir de 09:10, o primeiro horário é 09:15.
- **RN03. Bloco ocupado:** um agendamento ocupa a duração do serviço mais o tempo de preparo. O bloco inteiro precisa caber em um único intervalo de expediente. Com fim às 18:00, um serviço de 30 minutos com 10 de preparo começa no máximo às 17:20.
- **RN04. Conflitos:** um horário não é oferecido se o bloco sobrepuser um bloqueio ou o bloco de um agendamento não cancelado. Os intervalos são semiabertos, `[início, fim)`, então um bloco pode começar exatamente quando outro termina.
- **RN05. Antecedência:** na página pública, o início deve respeitar `agora + antecedência mínima <= início <= agora + antecedência máxima`. Cada negócio configura esses limites. O padrão é 1 hora e 30 dias.
- **RN06. Fuso:** cada negócio tem um fuso IANA, como `America/Sao_Paulo`. O expediente é guardado em hora local, e os instantes em UTC. Em mudanças de fuso, um horário local inexistente é descartado, e um ambíguo usa a primeira ocorrência.
- **RN07. Aptidão:** só atendem novas reservas os profissionais com `is_bookable = true`, vinculados a um serviço ativo.

## Agendamento

- **RN08. Confirmação:** agendamentos nascem confirmados se o horário estiver livre.
- **RN09. Um serviço:** cada agendamento tem exatamente um serviço.
- **RN10. Sem preferência:** o cliente pode escolher um profissional ou "sem preferência". Nesse caso, o sistema atribui o profissional apto e livre com menos agendamentos não cancelados no dia local do horário. O empate é resolvido pelo cadastro mais antigo e, depois, pelo menor `id`.
- **RN11. Cópia dos valores:** o agendamento guarda duração, preparo e preço do momento da reserva. Mudanças posteriores no serviço não o afetam, inclusive em remarcações.
- **RN12. Dados do cliente:** na página pública, nome, e-mail e telefone são obrigatórios. O e-mail não é verificado, então os dados pertencem ao agendamento e nunca são usados para associar reservas.
- **RN13. Idempotência:** a criação pública exige `Idempotency-Key`. A idempotência garante que o agendamento não é duplicado. Repetir a chave com os mesmos dados devolve o mesmo agendamento, **sem o link**, porque o token não pode ser recuperado do hash; nesse caso, o link fica disponível apenas pelo e-mail. A exceção ocorre quando o limite de e-mail impediu o envio na criação (RN26): a repetição gera um novo token, devolve o novo link e invalida o anterior. Essa troca de token é um efeito colateral aceito. Repetir a chave com dados diferentes é recusado.
- **RN14. Nenhum conflito:** duas operações simultâneas nunca podem deixar blocos sobrepostos no mesmo profissional, nem um bloco sobre um bloqueio. A garantia é aplicada no banco, conforme o [modelo de dados](06-modelo-dados.md#garantia-de-nenhum-conflito).

## Status

- **RN15. Ciclo de vida:** o agendamento nasce como `confirmed` e pode passar para:
  - `cancelled`: libera o horário.
  - `completed` ou `no_show`: marcados apenas pela equipe, a partir do início do atendimento, e continuam ocupando o tempo.

  Os três são status finais na V1.

## Link do cliente

- **RN16. Link seguro:** cada agendamento público ou manual com e-mail gera um token aleatório de alta entropia, guardado apenas como hash. O link funciona até 30 dias depois do início do atendimento. Token inválido ou expirado retorna `404`.
- **RN17. Prazo de alteração:** o cliente cancela ou remarca enquanto `agora <= início atual - prazo`. O limite exato é permitido. Cada negócio configura o prazo, com padrão de 2 horas. Depois disso, precisa falar com o negócio. Só agendamentos `confirmed` podem ser alterados.
- **RN18. Remarcação:** é uma troca atômica na mesma linha, com o mesmo link. O serviço e os valores copiados são mantidos, e o profissional pode mudar. O novo horário segue a antecedência e a disponibilidade. Se ele não estiver livre, o original é preservado. A disponibilidade pública não desconta o próprio agendamento, então um novo horário que sobreponha o atual não é oferecido.

## Equipe

- **RN19. Agendamento manual:** a equipe pode criar agendamentos sem os limites de antecedência. Só o nome do cliente é obrigatório. O horário precisa respeitar o expediente e as regras de conflito, não pode estar no passado e não precisa seguir a grade.
- **RN20. Alteração pela equipe:** a equipe cancela ou remarca sem o prazo do cliente, sob as mesmas restrições da RN19. Só agendamentos `confirmed` podem ser alterados.
- **RN21. Bloqueio sobre agendamento:** é recusado, e a resposta lista os agendamentos em conflito para serem resolvidos antes.
- **RN22. Mudança de expediente:** é aceita e vale para novas reservas. Os agendamentos existentes são mantidos, e a resposta lista os que ficaram fora do novo expediente. A troca do fuso do negócio segue a mesma regra, porque o expediente é guardado em hora local e passa a cobrir outros instantes.
- **RN23. Desativação:** é recusada enquanto o profissional tiver agendamentos futuros confirmados. Depois de desativado, o profissional sai das novas reservas e perde o acesso. Quando o Dono deixa de atender, mantém o login e apenas sai das novas reservas.

## Contas e demo

- **RN24. Convite e recuperação de senha:** usam links de uso único, guardados como hash. O convite vale 7 dias, e a recuperação, 1 hora. Um novo pedido invalida o link anterior ainda não usado. A recuperação responde igual para e-mail existente ou não, e só enfileira e-mail para conta ativa com convite já aceito. O profissional convidado nasce com `is_bookable = false` e só passa a `true` ao aceitar. Enquanto o convite estiver pendente, o Dono do mesmo negócio pode convidar o mesmo e-mail de novo, o que renova o link; em qualquer outro caso, o e-mail já usado é recusado.
- **RN25. Notificações:** o cliente recebe e-mail na criação, no cancelamento e na remarcação, quando houver endereço. Falha no envio nunca desfaz a operação. Os e-mails não incluem texto livre digitado pelo cliente.
- **RN26. Limites de e-mail:** o envio tem limites por destinatário e um teto diário global. Acima deles, o agendamento é mantido, nenhum e-mail é enfileirado, e a página pública mostra o link na tela. Se a criação pública for repetida com a mesma `Idempotency-Key`, o agendamento não é duplicado, e o link é trocado por um novo, conforme a RN13. Os e-mails de conta usam os mesmos contadores: acima do limite, a recuperação de senha continua respondendo `202` sem enfileirar nada, e o convite é recusado com `429`, sem criar conta nem token.
- **RN27. Cadastro:** `POST /auth/register` depende de `REGISTRATION_ENABLED`, que fica desligada na demo pública para evitar envio de mensagens enganosas a terceiros.
- **RN28. Restrições do negócio demo:** impedem o uso do negócio para enviar conteúdo livre a terceiros. O nome do negócio, o `slug` e o nome dos serviços ficam travados, a criação de serviços é recusada, e convites e recuperação de senha ficam desligados.
- **RN29. Restauração da demo:** toda noite, uma tarefa apaga e recria os dados do negócio demo, com datas relativas ao dia atual. Nenhum outro negócio é afetado. A demo mostra um aviso sobre essa restauração.
- **RN30. Política de senha:** a senha tem de 12 a 128 caracteres, sem regras de composição.
- **RN31. Validade da sessão:** o refresh expira depois de 7 dias sem uso, e cada renovação conta esse prazo de novo. A sessão termina, mesmo em uso, 30 dias depois do login: `expires_at = min(agora + 7 dias, início da família + 30 dias)`. O início da família é o menor `created_at` entre seus tokens, então a regra não exige coluna nova. Um novo login abre outra família, com novo limite de 30 dias.
