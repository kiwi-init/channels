---
description: kiwi loop inicia uma sessão nova do agente para cada tarefa, então toda tarefa começa com um contexto pequeno.
group: Agentes
order: 13
---

# Uma sessão por tarefa

Uma vaga não precisa viver numa sessão longa. `kiwi loop` roda numa janela do tmux na pasta da vaga e inicia uma sessão nova do harness para cada trabalho. A sessão acaba quando o trabalho termina, então toda tarefa começa pequena em vez de carregar tudo o que a vaga fez antes.

<!-- figure: loop -->

```bash
kiwi loop                                         # Claude Code, with its default model
kiwi loop --harness codex --model gpt-6-astra --effort high
kiwi loop --harness kimi                          # inside tmux: Kimi's first prompt is typed in
```

Ele roda `claude`, `codex`, `grok`, `mimo`, `kimi` ou `zcode`.

## O que ele escolhe

Nesta ordem:

1. Uma tarefa que a vaga está fazendo.
2. Uma rodada de revisão que ela deve.
3. As outras tarefas abertas dela.
4. Uma tarefa dela esperando um veredito.
5. Mensagens para ela.

Quando a vaga está livre, ele também pega uma especificação aprovada que espera um agente, com uma reserva para que dois loops nunca planejem a mesma.

## Como uma sessão roda

1. **Ele segura a vaga.** Nada mais lê as mensagens da vaga nem move o cursor dela, então o que chega espera pela sessão.
2. **Ele inicia o harness** num ambiente limpo, com um primeiro prompt que nomeia o trabalho, diz como ele termina (`kiwi task review T7 --at SHA`, `kiwi task done T7`, um veredito) e leva o checkpoint da tarefa.
3. **Ele liga a vaga** a essa sessão, então os hooks e comandos da sessão agem como a vaga.
4. **Ele encerra a sessão** quando o trabalho acaba: a tarefa feita ou passada adiante, a rodada de revisão fechada, nada sem ler. Ele espera a sessão ficar ociosa, no máximo 15 minutos, e então a para.

Enquanto uma sessão de código espera um veredito, só o que muda o trabalho dela a acorda: uma mensagem para ela, a conversa da tarefa, o veredito, uma pausa. Todo o resto espera a próxima sessão.

Uma tarefa longa pode pedir um recomeço: `kiwi task checkpoint T7 --fresh --file note.md` salva em que pé está e encerra a sessão depois do turno. A próxima sessão começa na mesma tarefa a partir desse checkpoint.

## Parando

Ctrl-C enquanto nenhuma sessão roda, ou SIGTERM ou SIGHUP a qualquer momento. O loop então libera a vaga. Um loop que morre sem soltar a vaga é substituído pelo próximo, ou liberado com `kiwi seat release --stale`.

O loop nunca responde aos diálogos de um harness ("Trust this folder?", pedidos de permissão): ele espera por você.

O líder continua numa sessão longa, mantida em forma pela compactação do próprio harness.
