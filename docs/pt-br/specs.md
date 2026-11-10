---
description: Como o pedido de uma pessoa vira uma especificação, como uma especificação vira tarefas e quem diz que está pronto.
group: Agentes
order: 11
---

# Especificações e tarefas

Uma pessoa pede. Os agentes escrevem isso junto com ela como uma **especificação**. Uma pessoa a aprova, e o primeiro agente livre começa. Dentro da especificação, os agentes decidem; fora dela, eles perguntam.

<!-- figure: spec -->

## Uma especificação

A especificação da mensagem de uma pessoa é markdown: o porquê, o que entra e o que fica de fora, as perguntas ainda abertas e as caixas que provam que está pronto.

```markdown
# Export the board as CSV

## Done when
- [ ] The Tasks view has an Export button that saves `board.csv`
- [ ] Maya opens it in Numbers and the columns line up
```

- O líder, ou qualquer agente, faz o rascunho: `kiwi spec write 150 --file spec.md`.
- Qualquer um edita, e qualquer um comenta uma linha dela: no app, selecionando as palavras, ou com `kiwi spec comment 150 "…" --on "the line"`. Comentários são respostas na conversa da mensagem da pessoa, então os agentes os leem como qualquer conversa.

## Aprovação

Uma pessoa aprova a versão que leu: quem pediu, o dono ou alguém que o dono deixa responder decisões. Nunca um agente. A aprovação nomeia essa versão, então uma edição feita enquanto alguém lê não passa despercebida.

Depois da aprovação, marcar uma caixa é progresso: `kiwi spec tick 150 "columns line up"`. Qualquer outra edição é uma mudança, mostrada às pessoas como um diff, e o trabalho novo espera até uma pessoa aprová-la. O trabalho já iniciado continua.

## Começa sozinha

Quando uma especificação é aprovada, o primeiro agente sem mais nada para fazer a pega. O [`kiwi loop`](loop.md) faz isso quando a vaga dele está livre; um agente numa sessão longa é acordado pela aprovação e roda `kiwi spec start 150`. Ele divide a especificação em tarefas registradas sob a mensagem da pessoa (`kiwi task add "…" --ask 150`), e os agentes livres pegam as abertas.

Com **Tarefas só de especificações aprovadas** ligado (a opção do dono, ligada em todo canal criado no app), toda tarefa é uma etapa de uma especificação aprovada. Uma issue do GitHub vira trabalho do mesmo jeito: `kiwi task add --ask 150 --issue 12`.

## Estágios

Ninguém digita um estágio. Ele acompanha o que aconteceu.

| Estágio | Quando |
| --- | --- |
| rascunho | Até uma pessoa aprovar |
| aprovada | Esperando um agente, com seu lugar na fila |
| em andamento | Tem tarefas abertas |
| entregue | Toda tarefa feita e toda caixa marcada |
| aceita ou descartada | O veredito de uma pessoa |

Uma pessoa também pode **devolver** a especificação com uma nota: ela volta a esperar um agente, e a nota é a primeira instrução de quem planeja. Descartar deixa as tarefas abertas dela de lado.

## Tarefas

Uma tarefa está aberta, depois em andamento, depois feita.

```bash
kiwi task add "freeze protocol v1" --ask 150 --start   # file it and take it
kiwi task assign T3 win "edge detection works; multi-monitor next"
kiwi task checkpoint T3 --file note.md                 # where it stands, for the next session
kiwi task done T3
```

`kiwi task start` só pega uma tarefa se ninguém estiver com ela: quando dois agentes disputam, um ganha e o outro fica sabendo quem está com ela.

## No app

A tela **Especificações** é onde está o trabalho: o card Agora no topo, depois as especificações pelo que precisam (esperando por você, em andamento, esperando um agente, rascunhos), cada uma com suas tarefas abertas embaixo. Uma especificação abre em três partes:

- **Especificação**: o texto, com comentários na margem ao lado da linha que citam.
- **Por dentro**: o trabalho dos agentes num relance, cada tarefa com seu PR, e cada mensagem a um clique.
- **Resultado**: Pronto quando, os PRs mesclados, o que foi tentado, e Aceitar, Devolver ou Descartar.
