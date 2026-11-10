---
description: Conecte um repo para que o canal veja os PRs, issues e checks dele, e para que o passo de merge de uma tarefa termine quando o PR for mesclado.
group: Conectar
order: 21
---

# GitHub

Conecte um repo e o canal vê os PRs, issues, checks, pushes e execuções de workflow dele na hora em que acontecem. O relay não consegue ler nem assinar no canal, então ele nunca posta lá sozinho: ele enfileira um aviso enxuto, e seu app o posta, assinado e criptografado, na próxima vez que estiver aberto.

<!-- figure: github -->

## Configure

1. **Vincule sua conta.** No app, Configurações → **GitHub** → **Vincular GitHub** mostra um código e abre `github.com/login/device`. Digite o código lá e aprove; o app então diz *Vinculado como @you*. O token fica no armazenamento criptografado do app naquele computador, nunca num canal nem com um agente. **Desvincular** o esquece.
2. **Instale o App.** Instale o **Kiwi Channels** nos repos, em cada conta ou organização dona de um deles.
3. **Conecte o repo** nas configurações do canal, em **Repos**. Você só pode conectar repos em que sua conta vinculada pode dar push.

Quando a lista de repos muda, seu app manda ao relay seu token de vínculo junto com esse único pedido. O relay pergunta ao GitHub, como você, se você pode dar push em cada repo, recusa a lista inteira se um falhar, e não guarda nada do token. Conecte repos só por um relay em que você confia para isso: um que registra o corpo dos pedidos poderia guardar o token.

## O que o relay vê

Quais repos um canal conectou, e cada evento até seu app buscá-lo: o repo, o número e o título do PR, a branch, o commit, o nome e o resultado do check, e quem fez. Nunca um corpo ou um diff. O GitHub já tem tudo isso. Os avisos na fila são descartados quando buscados, e de qualquer jeito depois de 7 dias ou 500 itens.

## O que um canal já tem

O GitHub só manda o que acontece depois que um repo é conectado. Então o app do dono, quando abre, quando um repo é conectado e a cada 6 horas, busca os PRs abertos do repo com os checks deles, as issues abertas e o que foi fechado nos últimos 30 dias, e posta só o que o canal ainda não sabe.

Quando a aba GitHub está vazia, ela diz por quê: se o App está instalado em cada repo (com o link de instalação quando não está), quais eventos ele recebe e quando chegou o último webhook. Um repo que foi movido para uma organização precisa do App instalado lá também.

## Revisões e merges

O Kiwi não bloqueia um merge no GitHub. O veredito de uma revisão fica na rodada da tarefa e na conversa dela, e quem revisa não o copia para o PR. O que o repo exige antes de um merge é assunto do próprio repo: suas regras, seu CI.

O passo `merge` de uma tarefa termina sozinho quando o app do dono vê o PR mesclado. Quando o PR foi mesclado antes da aprovação da tarefa, a nota do passo diz isso.

Os membros podem ler o diff de um commit contra a branch padrão pelo relay, só para repos conectados.

### Se as suas regras ainda exigem `kiwi/review`

O Kiwi postava um check por canal, `kiwi/review/<id do canal>`, que as regras de uma branch podiam exigir. Esse check foi aposentado. Enquanto as regras de um repo conectado ainda o exigirem, o app do dono responde a cada PR aberto ali com um check verde, "Retired: Kiwi no longer gates merges", para que nada fique esperando por ele. O `kiwi status` e a tela de Tarefas nomeiam o repo até você remover a exigência das regras. O Kiwi para de responder quando lê as regras e vê que a exigência saiu, e nenhuma data encerra isso antes.

## Issues viram tarefas

`kiwi task add --issue 12` registra uma tarefa a partir de uma issue do repo do canal, com o título dela. Fechar a issue fecha a tarefa. Fechar a tarefa só fecha a issue enquanto o dono estiver com *Escrever no GitHub* ligado.

## No seu próprio relay

Um relay que você roda precisa de um GitHub App próprio. [Self-hosting](self-hosting.md#github) tem os passos.
