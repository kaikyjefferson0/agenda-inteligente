# 2. Perfis de usuário

## Perfis

### Dono (`owner`)

Administra um negócio: configurações, serviços, equipe e todas as agendas. Também pode atender clientes. Nesse caso, passa a ter um registro de profissional e uma agenda própria.

### Profissional (`professional`)

Entra por convite do Dono e gerencia apenas a própria agenda: expediente, bloqueios e agendamentos.

### Cliente (sem conta)

Usa a página pública do negócio para ver horários e agendar. Depois, consulta, cancela ou remarca por um link seguro.

### Visitante

Pessoa sem conta que cadastra um novo negócio, quando o cadastro está habilitado.

## Fora da V1

- **Administrador da plataforma:** tarefas excepcionais são feitas diretamente no banco.
- **Recepção:** não existe papel intermediário entre Dono e Profissional.
- **Conta de cliente:** o cliente não faz login.

Cada conta pertence a um único negócio.

## Matriz de permissões

| Ação | Dono | Profissional | Cliente |
|---|---|---|---|
| Alterar configurações do negócio | Sim | Não | Não |
| Gerenciar serviços | Sim | Somente consulta | Consulta pública |
| Convidar, cancelar convite pendente e desativar profissionais | Sim | Não | Não |
| Definir serviços de cada profissional | Sim | Não | Não |
| Definir expediente | Todos | O próprio | Não |
| Registrar bloqueios | Todos | Os próprios | Não |
| Ver agenda | Todas | A própria | Não |
| Criar agendamento manual | Em qualquer agenda | Na própria agenda | Não |
| Alterar sem o prazo do cliente | Em qualquer agenda | Na própria agenda | Não |
| Marcar como concluído ou não compareceu | Em qualquer agenda | Na própria agenda | Não |
| Ver horários e agendar pela página pública | Sim | Sim | Sim |
| Consultar, cancelar e remarcar pelo link | Quem tiver o link | Quem tiver o link | Sim, dentro das regras |

## Regras de acesso

- O negócio é sempre obtido da sessão, nunca de um parâmetro enviado pelo usuário.
- Recurso de **outro negócio** retorna `404`, sem revelar que existe.
- Recurso do **mesmo negócio** sem permissão, como a agenda de um colega, retorna `403`.
- O acesso do cliente vale apenas para o agendamento do link.
