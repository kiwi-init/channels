---
description: Responda aos pedidos de permissão do Claude Code pelo Precisa de você do app ou pelo terminal, o que vier primeiro.
group: Agentes
order: 14
---

# Pedidos de permissão

Quando o Claude Code está prestes a perguntar se pode rodar algo, a mesma pergunta aparece no **Precisa de você** do app: o agente, a pasta, o que ele quer rodar e o motivo dele, com **Permitir uma vez** e **Negar**. O prompt do terminal continua aberto o tempo todo. Vale o que for respondido primeiro.

<!-- figure: permission -->

Vem ligado por padrão, para o Claude Code. Não muda nenhum modo nem regra: só entra em ação quando o Claude Code perguntaria de qualquer jeito.

## Quem pode responder

- **Permitir uma vez** só vem do humano do próprio agente.
- **Negar** vem desse humano ou do dono do canal.
- Todo o resto vê o card e não pode responder. Um agente nunca responde o próprio pedido.

Não existe "sempre permitir" pelo app: as regras ficam nas configurações do Claude Code, e uma regra de negação ali continua valendo. Uma chamada negada diz ao Claude "Denied from the Kiwi app by NAME".

## A espera

Até 30 minutos. Depois o card mostra permitido por NAME, negado por NAME, respondido no terminal, sem resposta do app, ou a sessão terminou. O prompt do terminal continua lá até ser respondido.

## O que aparece

| Ferramenta | O que o card mostra | Limite |
| --- | --- | --- |
| Bash | O comando e a descrição dele; um comando com o sandbox desligado ou em segundo plano é marcado | 2.000 caracteres. Com o sandbox desligado, só Negar |
| Edit, Write, MultiEdit, NotebookEdit | Os caminhos, o conteúdo novo e o texto que ele substitui | 4.000 caracteres cada. Permitir só quando tudo aparece |
| WebFetch | A URL | |
| Ferramentas MCP | O servidor, a ferramenta e os argumentos dela | 2.000 caracteres. Acima disso, só Negar |

Nada mais é enviado: nenhum outro arquivo, saída, ambiente ou transcrição.

## O que fica no terminal

- Qualquer outra ferramenta.
- Qualquer coisa que pareça um segredo: um token ou chave, um header `Authorization` ou de cookie, uma flag de senha, credenciais numa URL, uma URL de webhook, um JWT, uma string longa com cara de aleatória, um valor lido de `$TOKEN` ou `$(…)`.
- Uma edição num arquivo `.env`.
- Um comando, caminho ou pasta com caracteres invisíveis ou que mudam a direção do texto.
- Um segundo pedido enquanto um está esperando.
- Um agente sem humano no canal, um canal em pausa, ou uma sessão para a qual o Kiwi não tem vaga.

## Como funciona

A entrada roda `kiwi hooks install`, que adiciona um hook `PermissionRequest` ao Claude Code: `kiwi hook permission`, com timeout de 30 minutos. No modo `auto`, o classificador aprova a maioria das chamadas sozinho, então só o que ele não aprova chega ao Precisa de você.

O hook posta o pedido a partir da vaga do agente e espera uma resposta assinada. Quando a chamada é resolvida no terminal, ele vê isso na transcrição da sessão, limpa o card e não decide nada. Ele confere mais uma vez logo antes de responder, então uma resposta no terminal nunca é passada para trás.
