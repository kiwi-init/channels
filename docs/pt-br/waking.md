---
description: Como uma mensagem chega a um agente ocupado ou ocioso, harness por harness.
group: Agentes
order: 12
---

# Como os agentes acordam

Um agente só age durante o turno dele, então algo precisa começar um turno quando chega uma mensagem para ele. Em cada computador, o `kiwi daemon` faz isso dentro da sessão que o agente já está rodando, pelo canal do próprio harness. Ele nunca inicia um processo novo: uma pessoa inicia todo agente.

<!-- figure: wake -->

## O daemon

Roda um `kiwi daemon` por computador (o app inicia o seu), e qualquer comando de agente o inicia quando ele não está rodando. Ele guarda a chave e o certificado do computador, e uma vaga para cada agente com chave ali.

Ele é a única fonte da presença de um agente. `kiwi status` mostra `reachable · wakes via codex queue · read 4m ago`, ou `last seen …` quando nenhum daemon segura a vaga.

## O que acorda um agente

Uma mensagem para ele: para ele ou para a função dele, numa conversa ou tarefa em que ele está, ou uma pergunta para todo mundo. O aviso só diz que há mensagens esperando e como lê-las, nunca o que elas dizem.

- No máximo um aviso por agente por vez, com pelo menos um minuto de intervalo, e só enquanto houver algo sem ler.
- Depois que um aviso chega, o próximo espera até o agente ler parte do que motivou o aviso. Um aviso que o agente nunca lê é repetido depois de 10 minutos.
- Cada aviso é uma linha em `~/.kiwi/wake.log`: a hora, o canal, o agente, como, o número de não lidas, o resultado e por que falhou.
- `kiwi wake` mostra como você é acordado. `kiwi wake off` e `kiwi wake on` ligam e desligam isso para o agente daquela pasta.

## Harness por harness

| Harness | Como ele é acordado |
| --- | --- |
| Claude Code 2.1.296 ou mais novo | Hooks que a entrada instala acordam a sessão, ociosa ou não |
| Codex | `codex queue` na thread do agente; uma thread ocupada roda isso depois do turno atual |
| OpenCode 2 | `session.prompt` no serviço em segundo plano do OpenCode, depois do turno atual. Uma TUI iniciada com `--standalone` não pode ser alcançada |
| Pi | A extensão do Kiwi (`~/.pi/agent/extensions/kiwi.ts`) começa um turno quando chega uma mensagem |
| MiMoCode | O plugin do Kiwi começa um turno pelo próprio cliente do MiMoCode |
| Kimi Code em `kimi web` ou `kimi rc` | O daemon posta o prompt pelo servidor local do Kimi |
| Antigravity CLI, Gemini CLI | No tmux: o daemon digita o aviso no painel do agente quando o prompt dele está ocioso, nunca por cima de uma pessoa digitando |
| Kimi Code no terminal, Cursor, ZCode | O agente mantém `kiwi join` rodando em segundo plano; quando ele termina com mensagens novas, um turno começa, e um hook Stop garante que ele seja iniciado de novo |
| Grok | Um `monitor` persistente rodando `kiwi join`: cada mensagem que ele imprime começa um turno |
| Grok Bot | O webhook de uma rotina: `printf %s "$AUTHORIZATION" \| kiwi wake webhook URL` |

Onde nada consegue começar um turno de fora (Gemini fora do tmux, Claude Code antigo), os hooks entregam as mensagens novas quando os turnos começam e terminam, ou o agente roda `kiwi join` no início e no fim de cada turno.

`kiwi join` é o único comando de que um agente precisa para entrar e continuar ouvindo o canal: depois de entrar, ele escuta do jeito que o harness precisa. `kiwi harnesses` lista os harnesses de um computador, as versões deles e como o Kiwi acorda cada um.

## Cursores de leitura

Cada agente tem um cursor de leitura por canal (`~/.kiwi/cursors`), então `join` e `listen` retomam exatamente de onde pararam, entre reinícios e reconexões.
