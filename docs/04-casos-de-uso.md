# 4. Casos de uso

As regras citadas estão em [Regras de negócio](03-regras-negocio.md), e os testes, em [Casos de teste](05-casos-de-teste.md#rastreabilidade).

## Conta e equipe

### UC01. Cadastrar negócio e conta do Dono

- **Ator:** Visitante. **Regras:** RN27.
- **Fluxo:** informa dados do negócio e da conta; o sistema cria negócio e Dono em uma única transação, com os padrões de configuração, e inicia a sessão.
- **Exceções:** cadastro desligado; e-mail ou `slug` já em uso.

### UC02. Entrar, sair e renovar sessão

- **Atores:** Dono, Profissional.
- **Fluxo:** informa e-mail e senha; o sistema devolve um token de acesso curto e grava o refresh em um cookie HttpOnly. A sessão é renovada com rotação do refresh e encerrada com sua revogação.
- **Exceções:** credenciais inválidas, sem indicar qual campo errou; conta desativada; convite não aceito; reuso de refresh, que revoga toda a família de tokens.

### UC03. Recuperar senha

- **Atores:** Dono, Profissional. **Regras:** RN24, RN28.
- **Fluxo:** informa o e-mail e recebe um link de uso único; define a nova senha; as sessões existentes são revogadas.
- **Exceções:** link inválido, expirado ou já usado; a resposta não revela se o e-mail existe.

### UC04. Adicionar e desativar profissionais

- **Ator:** Dono. **Regras:** RN23, RN24, RN28.
- **Fluxo de convite:** informa nome e e-mail; o profissional recebe o link, define a senha e passa a poder entrar.
- **Fluxo do Dono:** passa a atender criando o próprio registro de profissional.
- **Fluxo de desativação:** o sistema confere os agendamentos futuros e desativa.
- **Exceções:** e-mail já em uso; há agendamentos futuros (`409`, com a lista); convite bloqueado na demo.

## Configuração

### UC05. Configurar o negócio

- **Ator:** Dono. **Regras:** RN01, RN05, RN06, RN17, RN28.
- **Fluxo:** altera nome, `slug`, fuso, passo da grade, antecedência e prazo de alteração. Os novos valores não afetam agendamentos existentes, exceto o prazo, que é avaliado no momento da alteração.
- **Exceções:** `slug` em uso; valores inválidos; campos travados na demo.

### UC06. Gerenciar serviços

- **Ator:** Dono. **Regras:** RN11, RN28.
- **Fluxo:** cria, edita ou desativa serviços com nome, duração, preparo e preço. Serviços com histórico são desativados, não excluídos.
- **Exceções:** valores inválidos; nome travado ou criação de serviço recusada na demo.

### UC07. Definir serviços de cada profissional

- **Ator:** Dono. **Regras:** RN07.
- **Fluxo:** escolhe os serviços do profissional, substituindo a lista anterior. Agendamentos existentes não mudam.
- **Exceções:** serviço ou profissional de outro negócio.

### UC08. Definir expediente semanal

- **Atores:** Dono, Profissional (o próprio). **Regras:** RN06, RN22.
- **Fluxo:** envia os intervalos de cada dia da semana, substituindo os anteriores. Um almoço recorrente é representado por dois intervalos no mesmo dia. A resposta lista agendamentos futuros que ficaram fora do novo expediente.
- **Exceções:** intervalos sobrepostos ou com fim antes do início.

### UC09. Registrar bloqueios

- **Atores:** Dono, Profissional (os próprios). **Regras:** RN14, RN21.
- **Fluxo:** informa início, fim e motivo de uma exceção, como uma folga, ou remove um bloqueio existente.
- **Exceções:** sobreposição com outro bloqueio; agendamento em conflito (`409`, com a lista).

## Cliente

### UC10. Consultar horários disponíveis

- **Ator:** Cliente. **Regras:** RN01 a RN07.
- **Fluxo:** escolhe serviço, data e, opcionalmente, profissional; o sistema retorna os horários livres.
- **Exceções:** `slug` ou serviço inexistente; data fora da antecedência retorna lista vazia.

### UC11. Criar agendamento e receber o link

- **Ator:** Cliente. **Regras:** RN05, RN07, RN08 a RN14, RN16, RN25, RN26.
- **Fluxo:** escolhe um horário e informa seus dados; o sistema atribui o profissional, se necessário, confirma, mostra o link e envia o e-mail.
- **Exceções:** horário ocupado nesse intervalo (`409`); limite de requisições (`429`); limite de e-mail, com link apenas na tela; chave de idempotência reenviada, com novo link se o limite de e-mail impediu o envio na criação.

### UC12. Consultar agendamento pelo link

- **Ator:** Cliente. **Regras:** RN16.
- **Fluxo:** abre o link e vê negócio, serviço, profissional, horário, status e as ações permitidas.
- **Exceções:** token inválido ou expirado (`404`).

### UC13. Cancelar pelo link

- **Ator:** Cliente. **Regras:** RN15, RN17, RN25, RN26.
- **Fluxo:** confirma o cancelamento; o horário é liberado, e o cliente recebe a confirmação por e-mail.
- **Exceções:** prazo vencido; agendamento em status final.

### UC14. Remarcar pelo link

- **Ator:** Cliente. **Regras:** RN05, RN17, RN18, RN25, RN26.
- **Fluxo:** escolhe um novo horário; o sistema troca de forma atômica e envia a confirmação por e-mail.
- **Exceções:** prazo vencido; agendamento em status final; novo horário ocupado, mantendo o original.

## Agenda da equipe

### UC15. Visualizar agenda

- **Atores:** Dono (todas), Profissional (a própria).
- **Fluxo:** escolhe um período e, no caso do Dono, opcionalmente um profissional; vê os agendamentos no fuso do negócio.
- **Exceções:** período acima do máximo; agenda de colega (`403`).

### UC16. Criar agendamento manual

- **Atores:** Dono, Profissional (na própria agenda). **Regras:** RN07, RN14, RN16, RN19, RN25, RN26.
- **Fluxo:** escolhe profissional, serviço e horário, e informa os dados do cliente. O e-mail é opcional; se informado, o cliente recebe o link.
- **Exceções:** fora do expediente; horário em conflito; horário no passado.

### UC17. Cancelar ou remarcar sem o prazo do cliente

- **Atores:** Dono, Profissional (na própria agenda). **Regras:** RN14, RN20, RN25, RN26.
- **Fluxo:** cancela ou remarca; o cliente recebe e-mail, quando houver endereço.
- **Exceções:** agendamento em status final; novo horário fora do expediente ou em conflito.

### UC18. Marcar como concluído ou não compareceu

- **Atores:** Dono, Profissional (na própria agenda). **Regras:** RN15.
- **Fluxo:** registra o resultado a partir do início do atendimento. O tempo continua ocupado.
- **Exceções:** antes do início; agendamento em status final.
